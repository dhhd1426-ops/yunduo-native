/* 云朵天气 5.0 · 动态壁纸播放器
 * 读 Wallpaper Engine 的 .mpkg / scene.pkg：解包 → 解码 .tex → 按 scene.json 分层用 WebGL 画出来。
 * 图层特效直接用包里自带的着色器（翻译成 WebGL1 能跑的 GLSL），所以不是只认这一张。
 * 目前支持：图片层、纯色层、单步特效（摇晃 shake、水波 waterwaves 以及同类单步着色器）。
 * 不支持的（粒子、文字、音频、多步特效、合成层）跳过，不影响其它层。
 * 景深：把图层拆成前后两段，分别画在两块画布上，App 的字夹在中间。
 */
window.WallScene = (function () {
  'use strict';

  /* ---------- 解包 ---------- */
  function u32(b, o) { return (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0; }
  function str(b, o, n) { return new TextDecoder().decode(b.subarray(o, o + n)); }
  function unpack(buf) {                       // PKGM0014（手机导出）/ PKGV00xx（电脑 scene.pkg）结构一样
    var b = new Uint8Array(buf), o = 0, vl = u32(b, 0); o = 4;
    var ver = str(b, o, vl); o += vl;
    if (!/^PKG[MV]/.test(ver)) throw new Error('不是 Wallpaper Engine 的壁纸包');
    var n = u32(b, o), ents = []; o += 4;
    for (var i = 0; i < n; i++) {
      var L = u32(b, o); o += 4; var name = str(b, o, L); o += L;
      var off = u32(b, o), sz = u32(b, o + 4); o += 8; ents.push([name, off, sz]);
    }
    var files = {};
    ents.forEach(function (e) { files[e[0]] = b.subarray(o + e[1], o + e[1] + e[2]); });
    return { ver: ver, files: files };
  }

  /* ---------- LZ4 块解压 ---------- */
  function lz4(src, n) {
    var dst = new Uint8Array(n), i = 0, j = 0, L = src.length;
    while (i < L) {
      var t = src[i++], lit = t >> 4;
      if (lit === 15) { var c; do { c = src[i++]; lit += c; } while (c === 255); }
      dst.set(src.subarray(i, i + lit), j); i += lit; j += lit;
      if (i >= L) break;
      var off = src[i] | src[i + 1] << 8; i += 2;
      var ml = t & 15; if (ml === 15) { var d; do { d = src[i++]; ml += d; } while (d === 255); }
      ml += 4; var s = j - off;
      if (off >= ml) { dst.copyWithin(j, s, s + ml); j += ml; }
      else for (var k = 0; k < ml; k++) dst[j++] = dst[s + k];
    }
    return dst;
  }

  /* ---------- DXT（BC1/2/3）软解 ---------- */
  function c565(c) { return [(c >> 11 & 31) * 255 / 31 | 0, (c >> 5 & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0]; }
  function dxt(src, w, h, kind) {
    var out = new Uint8Array(w * h * 4), bw = Math.ceil(w / 4), bh = Math.ceil(h / 4), p = 0, bs = kind === 1 ? 8 : 16;
    for (var by = 0; by < bh; by++) for (var bx = 0; bx < bw; bx++, p += bs) {
      var cp = kind === 1 ? p : p + 8, c0 = src[cp] | src[cp + 1] << 8, c1 = src[cp + 2] | src[cp + 3] << 8;
      var a = c565(c0), b = c565(c1), pal = [a, b];
      if (kind !== 1 || c0 > c1) { pal.push([(2 * a[0] + b[0]) / 3 | 0, (2 * a[1] + b[1]) / 3 | 0, (2 * a[2] + b[2]) / 3 | 0]); pal.push([(a[0] + 2 * b[0]) / 3 | 0, (a[1] + 2 * b[1]) / 3 | 0, (a[2] + 2 * b[2]) / 3 | 0]); }
      else { pal.push([(a[0] + b[0]) / 2 | 0, (a[1] + b[1]) / 2 | 0, (a[2] + b[2]) / 2 | 0]); pal.push([0, 0, 0]); }
      var bits = u32(src, cp + 4), al = null;
      if (kind === 5) {
        var a0 = src[p], a1 = src[p + 1], ap = [a0, a1];
        if (a0 > a1) for (var q = 1; q < 7; q++) ap.push(((7 - q) * a0 + q * a1) / 7 | 0); else { for (var r = 1; r < 5; r++) ap.push(((5 - r) * a0 + r * a1) / 5 | 0); ap.push(0, 255); }
        var ab = 0, am = 1; al = [];
        for (var z = 0; z < 6; z++) { ab += src[p + 2 + z] * am; am *= 256; }
        for (var y2 = 0; y2 < 16; y2++) { al.push(ap[ab % 8]); ab = Math.floor(ab / 8); }
      }
      for (var py = 0; py < 4; py++) for (var px = 0; px < 4; px++) {
        var x = bx * 4 + px, y = by * 4 + py, idx = py * 4 + px; if (x >= w || y >= h) continue;
        var col = pal[bits >>> (idx * 2) & 3], o = (y * w + x) * 4;
        out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2];
        out[o + 3] = kind === 1 ? ((c0 <= c1 && (bits >>> (idx * 2) & 3) === 3) ? 0 : 255) : kind === 3 ? (src[p + (idx >> 1)] >> ((idx & 1) * 4) & 15) * 17 : al[idx];
      }
    }
    return out;
  }

  /* ---------- .tex ---------- */
  function readTex(b) {                        // → Promise<{w,h,data:RGBA Uint8Array} | {w,h,image}>
    var o = 0;
    function s() { var e = b.indexOf(0, o), v = str(b, o, e - o); o = e + 1; return v; }
    function i32() { var v = u32(b, o) | 0; o += 4; return v; }
    s(); s();
    var fmt = i32(), flags = i32(), tw = i32(), th = i32(), iw = i32(), ih = i32(); i32();
    var cont = s(), nimg = i32(), ff = -1;
    if (cont === 'TEXB0003' || cont === 'TEXB0004') ff = i32();
    if (cont === 'TEXB0004') i32();
    var nmip = i32(), w = i32(), h = i32(), comp = 0, dsz = 0;
    if (cont !== 'TEXB0001') { comp = i32(); dsz = i32(); }
    var sz = i32(), data = b.subarray(o, o + sz);
    if (comp) data = lz4(data, dsz);
    var isImg = ff !== -1 && ((data[0] === 0xFF && data[1] === 0xD8) || (data[0] === 0x89 && data[1] === 0x50) || (data[0] === 0x47 && data[1] === 0x49) || (data[0] === 0x52 && data[1] === 0x49));
    if (isImg) {
      // 里面是一张普通图片（jpg/png）
      var blob = new Blob([data]);
      return createImageBitmap(blob).then(function (bm) { return { w: bm.width, h: bm.height, iw: iw || bm.width, ih: ih || bm.height, image: bm }; });
    }
    var px;
    if (fmt === 0) px = data;
    else if (fmt === 4) px = dxt(data, w, h, 5);
    else if (fmt === 6) px = dxt(data, w, h, 3);
    else if (fmt === 7) px = dxt(data, w, h, 1);
    else if (fmt === 8) { px = new Uint8Array(w * h * 4); for (var i = 0, n = w * h; i < n; i++) { px[i * 4] = data[i * 2]; px[i * 4 + 1] = data[i * 2 + 1]; px[i * 4 + 3] = 255; } }
    else if (fmt === 9) { px = new Uint8Array(w * h * 4); for (var k = 0, m = w * h; k < m; k++) { px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = data[k]; px[k * 4 + 3] = 255; } }
    else return Promise.reject(new Error('贴图格式 ' + fmt + ' 暂不支持'));
    // 贴图可能被补到 2 的幂：裁回图片本身的大小
    iw = iw || w; ih = ih || h;
    if (iw < w || ih < h) { var cut = new Uint8Array(iw * ih * 4); for (var y = 0; y < ih; y++) cut.set(px.subarray(y * w * 4, y * w * 4 + iw * 4), y * iw * 4); px = cut; w = iw; h = ih; }
    return Promise.resolve({ w: w, h: h, iw: iw, ih: ih, data: px });
  }

  /* ---------- 小工具 ---------- */
  function J(files, p) { var f = files[p]; if (!f) return null; try { return JSON.parse(str(f, 0, f.length).replace(/^﻿/, '')); } catch (e) { return null; } }
  function V(v) { return v && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? v.value : v; }   // 绑定了“用户属性”的值
  function vec(v, n, d) { v = V(v); if (v == null) return d; if (typeof v === 'number') return [v]; var a = String(v).trim().split(/\s+/).map(Number); while (a.length < n) a.push(d ? d[a.length] : 0); return a; }
  function bbox(px, w, h) {                     // 不透明部分的范围（全屏大图层里常常只有一小块有东西）
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y += 2) { var row = y * w * 4; for (var x = 0; x < w; x += 2) if (px[row + x * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - 8); y0 = Math.max(0, y0 - 8); x1 = Math.min(w, x1 + 10); y1 = Math.min(h, y1 + 10);
    return [x0, y0, x1, y1];
  }
  function sub(px, w, b) { var cw = b[2] - b[0], ch = b[3] - b[1], out = new Uint8Array(cw * ch * 4); for (var y = 0; y < ch; y++) out.set(px.subarray(((b[1] + y) * w + b[0]) * 4, ((b[1] + y) * w + b[2]) * 4), y * cw * 4); return out; }

  /* ---------- 着色器翻译：WE 的 HLSL 风格 GLSL → WebGL1 ---------- */
  var HEAD = [
    'precision highp float;',
    '#define mul(a,b) ((b)*(a))', '#define texSample2D texture2D', '#define frac fract', '#define lerp mix', '#define atan2 atan', '#define fmod mod',
    '#define saturate(x) clamp((x),0.0,1.0)', '#define CAST2(x) (vec2(x))', '#define CAST3(x) (vec3(x))', '#define CAST4(x) (vec4(x))', '#define CAST3X3(x) (mat3(x))',
    '#define M_PI 3.14159265359', '#define M_PI_HALF 1.57079632679', '#define M_PI_2 6.28318530718', '#define SQRT_2 1.41421356237', '#define SQRT_3 1.73205080756',
    '#define float2 vec2', '#define float3 vec3', '#define float4 vec4'
  ].join('\n') + '\n';
  var LIB = 'vec2 rotateVec2(vec2 v, float r){ vec2 cs = vec2(cos(r), sin(r)); return vec2(v.x*cs.x - v.y*cs.y, v.x*cs.y + v.y*cs.x); }\n' +
    'float greyscale(vec3 c){ return dot(c, vec3(0.11, 0.59, 0.3)); }\n';
  // WE 的 common_blending.h：常用的几种混合
  var BLEND = 'vec3 ApplyBlending(const int mode, vec3 A, vec3 B, float o){\n' +
    ' vec3 r = B;\n if (mode == 1) r = A * B; else if (mode == 2) r = A + B; else if (mode == 3) r = 1.0 - (1.0 - A) * (1.0 - B);\n' +
    ' else if (mode == 4) r = mix(2.0 * A * B, 1.0 - 2.0 * (1.0 - A) * (1.0 - B), step(0.5, A)); else if (mode == 5) r = min(A, B); else if (mode == 6) r = max(A, B);\n' +
    ' return mix(A, r, o); }\n';
  function scan(src) {                          // 找出 [COMBO] 默认值 和 带注释的 uniform
    var combos = {}, unis = [];
    src.replace(/\/\/\s*\[COMBO\]\s*(\{.*\})/g, function (m, j) { try { var o = JSON.parse(j); if (o.combo) combos[o.combo] = o.default | 0; } catch (e) {} return m; });
    src.replace(/uniform\s+(\w+)\s+(\w+)\s*(\[\d+\])?\s*;\s*\/\/\s*(\{.*\})/g, function (m, type, name, arr, j) { try { unis.push({ type: type, name: name, meta: JSON.parse(j) }); } catch (e) {} return m; });
    return { combos: combos, unis: unis };
  }
  function translate(src, defs, isFrag) {
    var src0 = src;
    src = src.replace(/#include\s+"[^"]*"/g, '').replace(/\r/g, '');
    // 把 texSample2D(g_TextureN, uv) 换成带裁剪换算的取样（大图层只上传有内容的那一块）
    src = src.replace(/texSample2D\s*\(\s*g_Texture(\d)\s*,/g, 'ydTex$1(');
    var used = {}; src.replace(/ydTex(\d)\(/g, function (m, n) { used[n] = 1; return m; });
    var helpers = Object.keys(used).map(function (n) { return 'uniform vec4 ydCrop' + n + ';\nvec4 ydTex' + n + '(vec2 uv){ return texture2D(g_Texture' + n + ', (uv - ydCrop' + n + '.xy) / ydCrop' + n + '.zw); }\n'; }).join('');
    var d = Object.keys(defs).map(function (k) { return '#define ' + k + ' ' + defs[k]; }).join('\n') + '\n';
    if (src.search(/void\s+main\s*\(/) < 0) throw new Error('no main');
    // 取样换算函数要放在所有 sampler 声明之后、第一个函数之前
    var re = /uniform\s+sampler2D\s+g_Texture\d[^\n]*\n/g, m, i = 0;
    while ((m = re.exec(src))) i = m.index + m[0].length;
    if (!i) { var f = src.search(/\n[\w]+\s+\w+\s*\([^;{]*\)\s*\{/); i = f < 0 ? src.search(/void\s+main\s*\(/) : f + 1; }
    return HEAD + d + src.slice(0, i) + LIB + (/common_blending/.test(src0) ? BLEND : '') + (isFrag ? helpers : '') + src.slice(i);
  }

  var BUILTIN = { 'util/white': [255, 255, 255, 255], 'util/black': [0, 0, 0, 255], 'util/noflow': [127, 127, 0, 255], 'util/clearalpha': [0, 0, 0, 0] };

  /* ---------- 场景 ---------- */
  function Scene(pkg) { this.files = pkg.files; this.json = J(pkg.files, 'scene.json'); this.project = J(pkg.files, 'project.json') || {}; if (!this.json) throw new Error('包里没有 scene.json（可能是视频或网页壁纸）'); }
  Scene.prototype.size = function () { var g = this.json.general || {}, p = g.orthogonalprojection; return p && p.width ? [p.width, p.height] : [1920, 1080]; };
  Scene.prototype.clear = function () { var g = this.json.general || {}; return g.clearenabled === false ? null : vec(g.clearcolor, 3, [0, 0, 0]); };
  // 把场景里能画的东西整理成图层表（还不上传显卡）
  Scene.prototype.layers = function () {
    var self = this, out = [];
    (this.json.objects || []).forEach(function (o, i) {
      if (V(o.visible) === false || !o.image) return;
      var model = J(self.files, o.image), L = { i: i, name: o.name || '', obj: o };
      if (/util\/solidlayer/.test(o.image)) { L.solid = 1; }
      else if (/util\/(composelayer|fullscreenlayer)/.test(o.image)) return;   // 合成层：要抓背景，暂不支持
      else {
        if (!model) return;
        var mat = J(self.files, model.material); if (!mat || !mat.passes) return;
        var tex = (mat.passes[0].textures || [])[0]; if (!tex) return;
        L.tex = 'materials/' + tex + '.tex'; if (!self.files[L.tex]) return;
        L.blend = mat.passes[0].blending || 'translucent';
      }
      L.origin = vec(o.origin, 3, [0, 0, 0]); L.scale = vec(o.scale, 3, [1, 1, 1]); L.angles = vec(o.angles, 3, [0, 0, 0]);
      L.size = vec(o.size, 2, null); L.alpha = V(o.alpha) == null ? 1 : +V(o.alpha); L.color = vec(o.color, 3, [1, 1, 1]);
      if ((+V(o.colorBlendMode) || 0) !== 0) return;                                  // 特殊混合模式：暂不支持，宁可不画
      L.effects = [];
      (o.effects || []).forEach(function (e) {
        if (V(e.visible) === false) return;
        var ej = J(self.files, e.file); if (!ej || !ej.passes || ej.passes.length !== 1 || ej.fbos || ej.passes[0].command) { if (/blur|bloom|glow|audio/i.test(e.file)) L.drop = 1; return L.skipped = (L.skipped || 0) + 1; }
        var mj = J(self.files, ej.passes[0].material); if (!mj || !mj.passes || mj.passes.length !== 1) return L.skipped = (L.skipped || 0) + 1;
        var sh = mj.passes[0].shader, vs = self.files['shaders/' + sh + '.vert'], fs = self.files['shaders/' + sh + '.frag'];
        if (!vs || !fs) return L.skipped = (L.skipped || 0) + 1;
        var ps = (e.passes || [])[0] || {};
        L.effects.push({ file: e.file, vs: str(vs, 0, vs.length), fs: str(fs, 0, fs.length), consts: ps.constantshadervalues || {}, textures: ps.textures || [], combos: Object.assign({}, mj.passes[0].combos || {}, ps.combos || {}) });
      });
      if (!L.drop) out.push(L);   // 靠模糊/音频才成立的装饰层（比如随音乐跳的光束），还原不了就不画
    });
    return out;
  };

  /* ---------- 渲染器：一块画布画一段图层 ---------- */
  function Renderer(canvas, scene, layers, opt) {
    opt = opt || {};
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: !!opt.keep });
    if (!gl) throw new Error('这台设备不支持 WebGL');
    this.gl = gl; this.canvas = canvas; this.scene = scene; this.layers = layers; this.opt = opt; this.S = scene.size();
    this.focus = opt.focus || [0.5, 0.5]; this.zoom = opt.zoom || 1; this.clearCol = opt.clear ? scene.clear() : null;
    var q = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, q); this.quad = q;
    this.base = this.prog(
      'attribute vec2 p; attribute vec2 t; uniform mat3 M; varying vec2 v; void main(){ vec3 q = M * vec3(p, 1.0); gl_Position = vec4(q.xy, 0.0, 1.0); v = t; }',
      'precision mediump float; uniform sampler2D s; uniform vec4 c; uniform float solid; varying vec2 v; void main(){ vec4 k = solid > 0.5 ? vec4(1.0) : texture2D(s, v); gl_FragColor = vec4(k.rgb * c.rgb, k.a * c.a); }');
    this.white = this.tex1(BUILTIN['util/white']);
    this.texCache = {};
  }
  Renderer.prototype.prog = function (vs, fs) {
    var gl = this.gl;
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(o); gl.deleteShader(o); throw new Error(e); } return o; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.loc = {}; p.U = function (n) { return n in p.loc ? p.loc[n] : (p.loc[n] = gl.getUniformLocation(p, n)); };
    return p;
  };
  Renderer.prototype.tex1 = function (c) { var gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(c)); this.params(); return { t: t, w: 1, h: 1, crop: [0, 0, 1, 1] }; };
  Renderer.prototype.params = function () { var gl = this.gl; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); };
  Renderer.prototype.upload = function (t, doCrop, pad) {  // → {t, w, h, iw, ih, crop:[u0,v0,du,dv]}
    var gl = this.gl, tx = gl.createTexture(), crop = [0, 0, 1, 1], w = t.w, h = t.h;
    gl.bindTexture(gl.TEXTURE_2D, tx); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (t.image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.image);
    else {
      var px = t.data, b = doCrop && w * h > 600000 ? bbox(px, w, h) : null;
      if (b && pad) { var pw = Math.round(w * pad), ph = Math.round(h * pad); b = [Math.max(0, b[0] - pw), Math.max(0, b[1] - ph), Math.min(w, b[2] + pw), Math.min(h, b[3] + ph)]; }  // 特效会把内容挪出原来的范围
      if (b && (b[2] - b[0]) * (b[3] - b[1]) < w * h * .8) { px = sub(px, w, b); crop = [b[0] / w, b[1] / h, (b[2] - b[0]) / w, (b[3] - b[1]) / h]; w = b[2] - b[0]; h = b[3] - b[1]; }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    this.params();
    return { t: tx, w: w, h: h, iw: t.iw, ih: t.ih, crop: crop };
  };
  Renderer.prototype.loadTex = function (name) {
    var self = this;
    if (name === 'util/noise' || name === 'util/perlin_256') {
      if (this.texCache[name]) return Promise.resolve(this.texCache[name]);
      var n = 256, px = new Uint8Array(n * n * 4), sd = 7;
      for (var i = 0; i < n * n * 4; i++) { sd = (sd * 1103515245 + 12345) & 0x7fffffff; px[i] = i % 4 === 3 ? 255 : sd >> 23; }
      var T = this.upload({ w: n, h: n, iw: n, ih: n, data: px }, false), gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, T.t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return Promise.resolve(this.texCache[name] = T);
    }
    if (BUILTIN[name]) return Promise.resolve(this.texCache[name] || (this.texCache[name] = this.tex1(BUILTIN[name])));
    var p = 'materials/' + name + '.tex'; if (!this.scene.files[p]) return Promise.resolve(null);
    if (this.texCache[p]) return Promise.resolve(this.texCache[p]);
    return readTex(this.scene.files[p]).then(function (t) { return (self.texCache[p] = self.upload(t, false)); });
  };
  Renderer.prototype.fbo = function (w, h) {
    var gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); this.params();
    var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { f: f, t: t, w: w, h: h };
  };
  Renderer.prototype.load = function () {        // 解码贴图、编译特效（逐层异步，不一次卡死）
    var self = this, gl = this.gl, warn = this.warn = [];
    return this.layers.reduce(function (pr, L) {
      return pr.then(function () {
        if (L.solid) { L.gtex = self.white; if (!L.size) L.size = [1, 1]; return; }
        return readTex(self.scene.files[L.tex]).then(function (t) {
          L.gtex = self.upload(t, true, L.effects.length ? .1 : 0);
          if (!L.size) L.size = [t.iw, t.ih];
          L.fx = [];
          return L.effects.reduce(function (p2, E) {
            return p2.then(function () {
              var sv = scan(E.vs), sf = scan(E.fs), defs = {}, k;
              for (k in sv.combos) defs[k] = sv.combos[k]; for (k in sf.combos) defs[k] = sf.combos[k];
              for (k in E.combos) defs[k] = E.combos[k];
              var unis = sv.unis.concat(sf.unis), texNames = [];
              unis.forEach(function (u) {
                var m = /^g_Texture(\d)$/.exec(u.name); if (!m) return; var n = +m[1];
                var nm = E.textures[n] != null ? E.textures[n] : (u.meta.default || null); texNames[n] = nm;
                if (u.meta.combo) defs[u.meta.combo] = E.textures[n] ? 1 : 0;
              });
              if (!('AUDIOPROCESSING' in defs)) defs.AUDIOPROCESSING = 0; else defs.AUDIOPROCESSING = 0;   // 不接麦克风
              var P;
              try { P = self.prog(translate(E.vs, defs, false), translate(E.fs, defs, true)); }
              catch (err) { warn.push(L.name + ' · ' + E.file + '：' + String(err.message || err).slice(0, 160)); return; }
              var vals = [];
              unis.forEach(function (u) {
                if (/^g_Texture/.test(u.name) || !u.meta.material && u.meta.default == null) return;
                var v = u.meta.material && E.consts[u.meta.material] != null ? E.consts[u.meta.material] : u.meta.default;
                if (v == null) return; vals.push({ n: u.name, type: u.type, v: vec(v, 4, [0, 0, 0, 0]) });
              });
              return Promise.all(texNames.map(function (nm, n) { return n === 0 || !nm ? null : self.loadTex(nm); })).then(function (ts) {
                L.fx.push({ P: P, vals: vals, tex: ts, fb: [self.fbo(L.gtex.w, L.gtex.h), null] });
              });
            });
          }, Promise.resolve());
        });
      }).then(function () { return new Promise(function (r) { setTimeout(r, 0); }); });   // 每层之间让一下主线程
    }, Promise.resolve()).then(function () { self.ready = true; return self; });
  };
  // 视口：场景里要显示的那一块（竖屏裁横版壁纸：按高度铺满，焦点决定左右）
  Renderer.prototype.view = function () {
    var cw = this.canvas.width, ch = this.canvas.height, W = this.S[0], H = this.S[1], a = cw / ch;
    var vh = H / this.zoom, vw = vh * a; if (vw > W / this.zoom) { vw = W / this.zoom; vh = vw / a; }
    var x0 = Math.max(0, Math.min(W - vw, this.focus[0] * W - vw / 2)), y0 = Math.max(0, Math.min(H - vh, (1 - this.focus[1]) * H - vh / 2));
    return [x0, y0, vw, vh];   // y0 从下往上（场景坐标 y 朝上）
  };
  Renderer.prototype.draw = function (time) {
    if (!this.ready) return;
    var gl = this.gl, self = this, vw = this.view();
    // 1) 各层的特效：把图层贴图过一遍（或几遍）着色器，结果留在帧缓冲里
    this.layers.forEach(function (L) {
      L.out = L.gtex;
      (L.fx || []).forEach(function (F, k) {
        var P = F.P, fb = F.fb[0], src = L.out;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb.f); gl.viewport(0, 0, fb.w, fb.h); gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(P);
        var c = L.gtex.crop;   // 这个四边形只覆盖有内容的那一块，但纹理坐标仍是整张图层的
        self.quadData([-1, -1, c[0], c[1] + c[3], 1, -1, c[0] + c[2], c[1] + c[3], -1, 1, c[0], c[1], 1, 1, c[0] + c[2], c[1]], P);
        gl.uniformMatrix4fv(P.U('g_ModelViewProjectionMatrix'), false, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        gl.uniform1f(P.U('g_Time'), time);
        F.vals.forEach(function (u) { var l = P.U(u.n); if (!l) return; var v = u.v;
          if (u.type === 'float') gl.uniform1f(l, v[0]); else if (u.type === 'vec2') gl.uniform2f(l, v[0], v[1]); else if (u.type === 'vec3') gl.uniform3f(l, v[0], v[1], v[2]); else if (u.type === 'vec4') gl.uniform4f(l, v[0], v[1], v[2], v[3]); else if (u.type === 'int') gl.uniform1i(l, v[0] | 0); });
        var texs = [src].concat(F.tex.slice(1));
        for (var n = 0; n < 8; n++) {
          var T = texs[n] || (n === 0 ? src : null); if (!T && !P.U('g_Texture' + n)) continue; T = T || self.white;
          gl.activeTexture(gl.TEXTURE0 + n); gl.bindTexture(gl.TEXTURE_2D, T.t); gl.uniform1i(P.U('g_Texture' + n), n);
          var tw = T.iw || T.w, th = T.ih || T.h;
          gl.uniform4f(P.U('g_Texture' + n + 'Resolution'), tw, th, tw, th);
          var cr = T.crop || [0, 0, 1, 1]; gl.uniform4f(P.U('ydCrop' + n), cr[0], cr[1], cr[2], cr[3]);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        var gc = L.gtex.crop;   // 帧缓冲是上下颠倒的：接下一个特效时按倒过来的范围取样
        L.out = { t: fb.t, w: fb.w, h: fb.h, crop: [gc[0], gc[1] + gc[3], gc[2], -gc[3]], iw: L.gtex.iw, ih: L.gtex.ih };
      });
    });
    // 2) 合成到画布
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    var cc = this.clearCol; gl.clearColor(cc ? cc[0] : 0, cc ? cc[1] : 0, cc ? cc[2] : 0, cc ? 1 : 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); var P = this.base; gl.useProgram(P);
    this.layers.forEach(function (L) {
      if (!L.out) return;
      if (L.blend === 'additive') gl.blendFunc(gl.SRC_ALPHA, gl.ONE); else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      var sw = L.size[0] * L.scale[0], sh = L.size[1] * L.scale[1], c = L.gtex.crop;
      // 图层四个角（场景坐标，y 朝上），只画有内容的那一块
      var ax = -sw / 2 + c[0] * sw, bx = ax + c[2] * sw, ay = sh / 2 - c[1] * sh, by = ay - c[3] * sh;
      var r = -(L.angles[2] || 0), cs = Math.cos(r), sn = Math.sin(r), ox = L.origin[0], oy = L.origin[1];
      function pt(x, y) { var X = ox + x * cs - y * sn, Y = oy + x * sn + y * cs; return [(X - vw[0]) / vw[2] * 2 - 1, (Y - vw[1]) / vw[3] * 2 - 1]; }
      var p0 = pt(ax, by), p1 = pt(bx, by), p2 = pt(ax, ay), p3 = pt(bx, ay);
      var fx = L.out !== L.gtex;   // 帧缓冲里的结果是倒过来的
      self.quadData(fx ? [p0[0], p0[1], 0, 0, p1[0], p1[1], 1, 0, p2[0], p2[1], 0, 1, p3[0], p3[1], 1, 1] : [p0[0], p0[1], 0, 1, p1[0], p1[1], 1, 1, p2[0], p2[1], 0, 0, p3[0], p3[1], 1, 0], P, true);
      gl.uniformMatrix3fv(P.U('M'), false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, L.out.t); gl.uniform1i(P.U('s'), 0);
      gl.uniform1f(P.U('solid'), L.solid ? 1 : 0);
      gl.uniform4f(P.U('c'), L.color[0], L.color[1], L.color[2], L.alpha);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
  };
  Renderer.prototype.quadData = function (d, P, base) {
    var gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d), gl.DYNAMIC_DRAW);
    var a = gl.getAttribLocation(P, base ? 'p' : 'a_Position'), b = gl.getAttribLocation(P, base ? 't' : 'a_TexCoord');
    if (a >= 0) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 16, 0); }
    if (b >= 0) { gl.enableVertexAttribArray(b); gl.vertexAttribPointer(b, 2, gl.FLOAT, false, 16, 8); }
  };
  Renderer.prototype.destroy = function () { var e = this.gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); };

  /* ---------- 景深：哪些层在字后面 ---------- */
  function splitIndex(layers, S) {
    // 从下往上，连续的“铺满全屏的不透明层”算背景；其余在字前面
    var k = 0;
    for (var i = 0; i < layers.length; i++) { var L = layers[i], sw = (L.size ? L.size[0] : 0) * L.scale[0], sh = (L.size ? L.size[1] : 0) * L.scale[1];
      if (!L.solid && sw >= S[0] * .95 && sh >= S[1] * .95 && (!L.gtex || L.gtex.crop[2] > .95)) k = i + 1; else break; }
    return Math.max(1, k);
  }

  return { unpack: unpack, readTex: readTex, lz4: lz4, Scene: Scene, Renderer: Renderer, splitIndex: splitIndex };
})();
