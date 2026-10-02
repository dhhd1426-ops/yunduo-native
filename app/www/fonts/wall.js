/* 云朵天气 5.0 · 动态壁纸播放器
 * 读 Wallpaper Engine 的 .mpkg / scene.pkg：解包 → 解码 .tex → 按 scene.json 分层用 WebGL 画出来。
 * 图层特效直接用包里自带的着色器（翻译成 WebGL1 能跑的 GLSL），所以不是只认这一张。
 * 5.11 起照 WE 的运行方式：图片层、纯色层、多步特效（具名缓冲 fbos / bind / target）、抓背景的合成层（fullscreenlayer /
 * composelayer + copybackground）、粒子（常用发射器/初始化/运算）、随声音动（g_AudioSpectrum*）、用户属性绑定（project.json 的设置实时生效）。
 * 还不支持的（文字层、3D 模型、脚本、特殊颜色混合）跳过，不影响其它层。
 * 景深：把图层拆成前后两段，分别画在两块画布上，App 的字夹在中间。
 */
function __wallFactory() {   // 5.12 写成具名函数：后台线程（OffscreenCanvas）里用 toString() 再建一份同样的引擎
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

  // 解包后的磁盘资源：后台线程向主线程要字节，主线程模式直接 XHR。
  function readAsset(src) {
    if (typeof src !== 'string') return Promise.resolve(src);
    if (typeof self !== 'undefined' && self.__wallReadAsset) return self.__wallReadAsset(src);
    return new Promise(function (ok, no) {
      var x = new XMLHttpRequest(); x.open('GET', src, true); x.responseType = 'arraybuffer';
      x.onload = function () { if ((x.status === 0 || x.status < 400) && x.response) ok(new Uint8Array(x.response)); else no(new Error('读不到壁纸贴图')); };
      x.onerror = function () { no(new Error('读不到壁纸贴图')); }; x.send();
    });
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

  /* ---------- 5.8.1 贴图在后台线程解（LZ4 / DXT / 裁边 / 找不透明范围），主线程不卡开屏动画 ---------- */
  var TW = null, twSeq = 0, twCb = {};
  function worker() {
    if (TW !== null) return TW;
    if (typeof document === 'undefined') return (TW = false);   // 自己已经在后台线程里了：直接解
    try {
      var src = [u32, str, lz4, c565, dxt, bbox, readTex].map(String).join('\n') +
        '\nonmessage = function (e) { var d = e.data; readTex(new Uint8Array(d.buf)).then(function (t) {' +
        ' if (d.box && t.data && t.w * t.h > 600000) t.box = bbox(t.data, t.w, t.h) || 0;' +
        ' postMessage({ id: d.id, t: t }, t.image ? [t.image] : t.data ? [t.data.buffer] : []); }, function (err) { postMessage({ id: d.id, err: String(err && err.message || err) }); }); };';
      TW = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      TW.onmessage = function (e) { var c = twCb[e.data.id]; delete twCb[e.data.id]; if (c) { if (e.data.err) c[1](new Error(e.data.err)); else c[0](e.data.t); } };
      TW.onerror = function () { var cbs = twCb; twCb = {}; TW = false; Object.keys(cbs).forEach(function (k) { cbs[k][2](); }); };
    } catch (e) { TW = false; }
    return TW;
  }
  function readTexBg(b, box) {                   // 和 readTex 一样，只是放到 Worker 里；Worker 不能用时退回主线程
    var w = worker();
    if (!w) return readTex(b);
    return new Promise(function (ok, no) {
      var id = ++twSeq, buf = b.slice().buffer;
      twCb[id] = [ok, no, function () { readTex(b).then(ok, no); }];
      w.postMessage({ id: id, buf: buf, box: !!box }, [buf]);
    });
  }

  /* ---------- 小工具 ---------- */
  function J(files, p) { var f = files[p]; if (!f) return null; try { return JSON.parse(str(f, 0, f.length).replace(/^﻿/, '')); } catch (e) { return null; } }
  function bbox(px, w, h) {                     // 不透明部分的范围（全屏大图层里常常只有一小块有东西）
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) { var row = y * w * 4; for (var x = 0; x < w; x++) if (px[row + x * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
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
    '#define float2 vec2', '#define float3 vec3', '#define float4 vec4', '#define log10(x) (log(x) * 0.4342944819)'
  ].join('\n') + '\n';
  // WE 的 common.h 里常用的几个函数
  var LIB = 'vec2 rotateVec2(vec2 v, float r){ vec2 cs = vec2(cos(r), sin(r)); return vec2(v.x*cs.x - v.y*cs.y, v.x*cs.y + v.y*cs.x); }\n' +
    'float greyscale(vec3 c){ return dot(c, vec3(0.11, 0.59, 0.3)); }\n' +
    'vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10; return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }\n' +
    'vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }\n';
  // 5.11 common_blending.h：按 WE 编辑器里混合模式的顺序（0 正常 1 变暗 2 正片叠底 3 颜色加深 4 线性加深 5 变亮 6 滤色 7 颜色减淡 8 线性减淡
  // 9 叠加 10 柔光 11 强光 12 亮光 13 线性光 14 点光 15 实色混合 16 差值 17 排除 18 减去 19 反射 20 发光 21 凤凰 22 平均 23 否定 24–27 色相/饱和度/颜色/明度）
  var BLEND = [
    'float ydLum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }',
    'vec3 ydBurn(vec3 A, vec3 B){ return mix(max(1.0 - (1.0 - A) / max(B, 1e-4), 0.0), vec3(0.0), step(B, vec3(1e-4))); }',
    'vec3 ydDodge(vec3 A, vec3 B){ return mix(min(A / max(1.0 - B, 1e-4), 1.0), vec3(1.0), step(vec3(1.0 - 1e-4), B)); }',
    'vec3 ydSetLum(vec3 c, float l){ vec3 r = c + (l - ydLum(c)); float L = ydLum(r), n = min(min(r.r, r.g), r.b), x = max(max(r.r, r.g), r.b);',
    ' if (n < 0.0) r = L + (r - L) * L / max(L - n, 1e-4); if (x > 1.0) r = L + (r - L) * (1.0 - L) / max(x - L, 1e-4); return r; }',
    'vec3 ApplyBlending(const int mode, vec3 A, vec3 B, float o){',
    ' vec3 r = B;',
    ' if (mode == 1) r = min(A, B); else if (mode == 2) r = A * B; else if (mode == 3) r = ydBurn(A, B); else if (mode == 4) r = max(A + B - 1.0, 0.0);',
    ' else if (mode == 5) r = max(A, B); else if (mode == 6) r = 1.0 - (1.0 - A) * (1.0 - B); else if (mode == 7) r = ydDodge(A, B); else if (mode == 8) r = min(A + B, 1.0);',
    ' else if (mode == 9) r = mix(2.0 * A * B, 1.0 - 2.0 * (1.0 - A) * (1.0 - B), step(0.5, A));',
    ' else if (mode == 10) r = mix(2.0 * A * B + A * A * (1.0 - 2.0 * B), sqrt(A) * (2.0 * B - 1.0) + 2.0 * A * (1.0 - B), step(0.5, B));',
    ' else if (mode == 11) r = mix(2.0 * A * B, 1.0 - 2.0 * (1.0 - A) * (1.0 - B), step(0.5, B));',
    ' else if (mode == 12) r = mix(ydBurn(A, 2.0 * B), ydDodge(A, 2.0 * (B - 0.5)), step(0.5, B));',
    ' else if (mode == 13) r = clamp(A + 2.0 * B - 1.0, 0.0, 1.0);',
    ' else if (mode == 14) r = mix(min(A, 2.0 * B), max(A, 2.0 * (B - 0.5)), step(0.5, B));',
    ' else if (mode == 15) r = step(1.0, A + B);',
    ' else if (mode == 16) r = abs(A - B); else if (mode == 17) r = A + B - 2.0 * A * B; else if (mode == 18) r = max(A - B, 0.0);',
    ' else if (mode == 19) r = mix(min(A * A / max(1.0 - B, 1e-4), 1.0), vec3(1.0), step(vec3(1.0 - 1e-4), B));',
    ' else if (mode == 20) r = mix(min(B * B / max(1.0 - A, 1e-4), 1.0), vec3(1.0), step(vec3(1.0 - 1e-4), A));',
    ' else if (mode == 21) r = min(A, B) - max(A, B) + 1.0; else if (mode == 22) r = (A + B) * 0.5; else if (mode == 23) r = 1.0 - abs(1.0 - A - B);',
    ' else if (mode == 24 || mode == 26) r = ydSetLum(B, ydLum(A)); else if (mode == 25) r = mix(vec3(ydLum(A)), A, clamp(length(B - vec3(ydLum(B))) * 2.0, 0.0, 1.0)); else if (mode == 27) r = ydSetLum(A, ydLum(B));',
    ' return mix(A, r, o); }'
  ].join('\n') + '\n';
  function scan(src) {                          // 找出 [COMBO] 默认值 和 带注释的 uniform
    var combos = {}, unis = [];
    src.replace(/\/\/\s*\[COMBO\]\s*(\{.*\})/g, function (m, j) { try { var o = JSON.parse(j); if (o.combo) combos[o.combo] = o.default | 0; } catch (e) {} return m; });
    src.replace(/uniform\s+(\w+)\s+(\w+)\s*(\[\d+\])?\s*;\s*\/\/\s*(\{.*\})/g, function (m, type, name, arr, j) { try { unis.push({ type: type, name: name, meta: JSON.parse(j) }); } catch (e) {} return m; });
    return { combos: combos, unis: unis };
  }
  function translate(src, defs, isFrag) {
    var src0 = src;
    src = src.replace(/#include\s+"[^"]*"/g, '').replace(/\r/g, '');
    // HLSL 习惯写法：1.0f、把 texSample2D 的结果直接赋给 float、组合开关当布尔用、循环上下限是变量
    src = src.replace(/(\d+\.\d*|\.\d+)f\b/g, '$1').replace(/\b(\d+)f\b/g, '$1.0');
    src = src.replace(/(\bfloat\s+\w+\s*=\s*)(texSample2D\s*\((?:[^()]|\([^()]*\))*\))\s*;/g, '$1$2.r;');
    Object.keys(defs).forEach(function (k) { src = src.replace(new RegExp('([=(,:?]\\s*)' + k + '\\s*\\?', 'g'), '$1(' + k + ' != 0) ?'); });
    src = src.replace(/for\s*\(\s*int\s+(\w+)\s*=\s*([^;]+);\s*\1\s*(<=|<)\s*([^;]+);\s*(?:\+\+\1|\1\s*\+\+|\1\s*\+=\s*1)\s*\)\s*\{/g, function (m, v, a, op, b) {
      if (/^\s*-?\d+\s*$/.test(a) && /^\s*-?\d+\s*$/.test(b)) return m;
      return 'for (int ' + v + ' = 0; ' + v + ' < 64; ' + v + '++) { if (' + v + ' < (' + a + ') || !(' + v + ' ' + op + ' (' + b + '))) continue;';
    });
    // 片元着色器里 uniform 数组不能用算出来的下标（WebGL1）：g_AudioSpectrum64Left[x]（或用 #define 起的别名）换成按常量下标逐个比的小函数，
    // 小函数紧跟在数组声明后面（同一个 #if 里）；别名多定义一个 别名__AUD 指向对应的小函数
    if (isFrag && /g_AudioSpectrum(16|32|64)(Left|Right)\s*\[/.test(src)) {
      var names = {};
      src = src.replace(/uniform\s+float\s+(g_AudioSpectrum(16|32|64)(?:Left|Right))\s*\[\s*\d+\s*\]\s*;[^\n]*/g, function (m, nm, n) {
        names[nm] = 'ydAud_' + nm;   // \u0001 先占住声明和小函数里的 [，下面替换时跳过，最后去掉
        return 'uniform float ' + nm + '\u0001[' + n + '];\nfloat ydAud_' + nm + '(int i){ for (int k = 0; k < ' + n + '; k++) { if (k == i) return ' + nm + '\u0001[k]; } return 0.0; }';
      });
      src = src.replace(/#define\s+(\w+)\s+(g_AudioSpectrum(?:16|32|64)(?:Left|Right))\b[^\n]*/g, function (m, al, nm) { names[al] = al + '__AUD'; return m + '\n#define ' + al + '__AUD ydAud_' + nm; });
      Object.keys(names).forEach(function (nm) {
        var re3 = new RegExp('\\b' + nm + '\\s*\\[', 'g'), out = '', i0 = 0, mm;
        while ((mm = re3.exec(src))) {
          var k = mm.index + mm[0].length, dep = 0;
          for (; k < src.length; k++) { var ch = src[k]; if (ch === '[' || ch === '(') dep++; else if (ch === ')') dep--; else if (ch === ']') { if (dep === 0) break; dep--; } }
          out += src.slice(i0, mm.index) + names[nm] + '(int(' + src.slice(mm.index + mm[0].length, k) + '))'; i0 = k + 1; re3.lastIndex = k + 1;
        }
        src = out + src.slice(i0);
      });
      src = src.replace(/\u0001/g, '');
    }
    // 把 texSample2D(g_TextureN, uv) 换成带裁剪换算的取样（大图层只上传 / 只处理有内容的那一块）
    src = src.replace(/texSample2D\s*\(\s*g_Texture(\d)\s*,/g, 'ydTex$1(');
    var used = {}; src.replace(/ydTex(\d)\(/g, function (m, n) { used[n] = 1; return m; });
    var helpers = Object.keys(used).map(function (n) { return 'uniform vec4 ydCrop' + n + ';\nvec4 ydTex' + n + '(vec2 uv){ return texture2D(g_Texture' + n + ', (uv - ydCrop' + n + '.xy) / ydCrop' + n + '.zw); }\n'; }).join('');
    // #if 里用到但没定义的开关（比如只有竖向那一步才设的 VERTICAL）：WebGL 会报错，HLSL 编译器当 0
    var dd = Object.assign({}, defs), own = {};
    src.replace(/#define\s+(\w+)/g, function (m, k) { own[k] = 1; return m; });
    src.replace(/#(?:el)?if\s+([^\n]*)/g, function (m, e) { e.replace(/defined\s*\(?\s*\w+\s*\)?/g, '').replace(/\b[A-Za-z_]\w*\b/g, function (k) { if (!(k in dd) && !own[k]) dd[k] = 0; return k; }); return m; });
    var d = Object.keys(dd).map(function (k) { return '#define ' + k + ' ' + dd[k]; }).join('\n') + '\n';
    if (src.search(/void\s+main\s*\(/) < 0) throw new Error('no main');
    // 取样换算函数要放在所有 sampler 声明之后、第一个函数之前
    var re = /uniform\s+sampler2D\s+g_Texture\d[^\n]*\n/g, m, i = 0;
    while ((m = re.exec(src))) i = m.index + m[0].length;
    if (!i) { var f = src.search(/\n[\w]+\s+\w+\s*\([^;{]*\)\s*\{/); i = f < 0 ? src.search(/void\s+main\s*\(/) : f + 1; }
    return HEAD + d + src.slice(0, i) + LIB + (/common_blending/.test(src0) ? BLEND : '') + (isFrag ? helpers : '') + src.slice(i);
  }

  var BUILTIN = { 'util/white': [255, 255, 255, 255], 'util/black': [0, 0, 0, 255], 'util/noflow': [127, 127, 0, 255], 'util/clearalpha': [0, 0, 0, 0] };

  /* ---------- 5.11 用户属性（project.json 的 general.properties）和绑定 ---------- */
  // scene.json 里任何值都可能写成 {"user":"名字","value":默认} 或 {"user":{"name":"名字","condition":"值"},"value":…}
  function userProps(project) {
    var P = ((project || {}).general || {}).properties || {};
    return Object.keys(P).map(function (k) { return Object.assign({ key: k }, P[k] || {}); })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0) || (a.index || 0) - (b.index || 0); });
  }
  function propDefaults(project) { var o = {}; userProps(project).forEach(function (p) { if ('value' in p) o[p.key] = p.value; }); return o; }
  function truthy(x) { return !(x === false || x === 0 || x === '0' || x === 'false' || x == null || x === ''); }
  function bind(v, props) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !('user' in v || 'value' in v)) return v;
    var u = v.user, val = v.value;
    if (u && props) {
      if (typeof u === 'string') { if (u in props) return like(props[u], val); }
      else if (u.name && u.name in props) { var cur = props[u.name]; return 'condition' in u ? String(cur) === String(u.condition) : like(cur, val); }
    }
    return val;
  }
  function like(x, ref) { if (typeof ref === 'boolean') return truthy(x); if (typeof ref === 'number') { var n = +x; return isNaN(n) ? ref : n; } return x; }
  function V(v, props) { return bind(v, props); }
  function vec(v, n, d, props) {
    v = bind(v, props); if (v == null) return d;
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (typeof v === 'number') { var r = []; for (var i = 0; i < n; i++) r.push(v); return r; }
    var a = String(v).trim().split(/\s+/).map(Number);
    if (a.length === 1 && n > 1) while (a.length < n) a.push(a[0]);
    while (a.length < n) a.push(d ? d[a.length] : 0); return a;
  }

  /* ---------- 场景 ---------- */
  function Scene(pkg) { this.files = pkg.files; this.json = J(pkg.files, 'scene.json'); this.project = J(pkg.files, 'project.json') || {}; if (!this.json) throw new Error('包里没有 scene.json（可能是视频或网页壁纸）'); }
  Scene.prototype.size = function () { var g = this.json.general || {}, p = g.orthogonalprojection; return p && p.width ? [p.width, p.height] : [1920, 1080]; };
  Scene.prototype.clear = function () { var g = this.json.general || {}; return g.clearenabled === false ? null : vec(g.clearcolor, 3, [0, 0, 0]); };
  Scene.prototype.userProps = function () { return userProps(this.project); };
  Scene.prototype.defaults = function () { return propDefaults(this.project); };
  Scene.prototype.audio = function () { return !!((this.project.general || {}).supportsaudioprocessing); };
  // 把场景里能画的东西整理成图层表（还不上传显卡）。绑定了用户属性的显示/隐藏、数值都留着原样，画的时候再按当前设置取
  Scene.prototype.layers = function () {
    var self = this, out = [], files = this.files;
    (this.json.objects || []).forEach(function (o, i) {
      if (o.visible === false) return;                                     // 写死不显示的
      var L = { i: i, name: o.name || '', obj: o, vis: o.visible, alphaR: o.alpha, colorR: o.color, effects: [] };
      L.origin = vec(o.origin, 3, [0, 0, 0]); L.scale = vec(o.scale, 3, [1, 1, 1]); L.angles = vec(o.angles, 3, [0, 0, 0]);
      if (o.particle) {                                                    // 粒子
        var pj = J(files, o.particle); if (!pj) return;
        var pm = pj.material && J(files, pj.material), pp = pm && pm.passes && pm.passes[0] || {};
        L.kind = 'particle'; L.ps = pj; L.over = o.instanceoverride || {}; L.blend = pp.blending || 'additive'; L.ptex = (pp.textures || [])[0] || 'particle/halo';
        out.push(L); return;
      }
      if (!o.image) return;
      if (/util\/solidlayer/.test(o.image)) L.kind = 'solid';
      else if (/util\/(composelayer|fullscreenlayer)/.test(o.image)) {   // 合成层：把下面已经画好的画面抓过来再加特效
        if (!o.copybackground) return;
        L.kind = 'capture'; L.full = /fullscreen/.test(o.image);
      } else {
        var model = J(files, o.image); if (!model) return;
        var mat = J(files, model.material); if (!mat || !mat.passes) return;
        var tex = (mat.passes[0].textures || [])[0]; if (!tex) return;
        L.tex = 'materials/' + tex + '.tex'; if (!files[L.tex]) return;
        L.kind = 'image'; L.blend = mat.passes[0].blending || 'translucent';
      }
      L.size = vec(o.size, 2, null);
      if (L.kind === 'capture') { var S = self.size(); if (L.full || !L.size) { L.size = [S[0], S[1]]; L.origin = [S[0] / 2, S[1] / 2, 0]; L.scale = [1, 1, 1]; L.angles = [0, 0, 0]; } }
      if ((+bind(o.colorBlendMode) || 0) !== 0) return;                    // 特殊混合模式：暂不支持，宁可不画
      (o.effects || []).forEach(function (e) {
        if (e.visible === false) return;
        var ej = J(files, e.file), bad = !ej || !ej.passes || !ej.passes.length;
        var E = { file: e.file, vis: e.visible, fbos: ((ej && ej.fbos) || []).map(function (f) { return { name: f.name, scale: Math.max(1, +f.scale || 1) }; }), passes: [] };
        if (!bad) ej.passes.forEach(function (p, pi) {
          var sp = (e.passes || [])[pi] || {};
          if (p.command) { E.passes.push({ command: p.command, source: p.source || 'previous', target: p.target || '' }); return; }
          var mj = J(files, p.material), mp = mj && mj.passes && mj.passes[0]; if (!mp) { bad = true; return; }
          var sh = mp.shader, vs = files['shaders/' + sh + '.vert'], fs = files['shaders/' + sh + '.frag'];
          if (!vs || !fs) { bad = true; return; }
          var bm = {}; (p.bind || []).forEach(function (b) { bm[b.index] = b.name; });
          E.passes.push({ vs: str(vs, 0, vs.length), fs: str(fs, 0, fs.length), consts: sp.constantshadervalues || {}, textures: sp.textures || [], mtex: mp.textures || [],
            combos: Object.assign({}, mp.combos || {}, sp.combos || {}), bind: bm, target: p.target || '' });
        });
        if (bad || !E.passes.some(function (p) { return !p.command; })) { if (/blur|bloom|glow/i.test(e.file)) L.drop = 1; L.skipped = (L.skipped || 0) + 1; return; }
        L.effects.push(E);
      });
      if (!L.drop) out.push(L);   // 靠模糊/辉光才成立的装饰层，还原不了就不画
    });
    return out;
  };

  /* ---------- 5.11 粒子（WE 粒子系统的常用部分：发射器 / 初始化 / 运算 / 精灵） ---------- */
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function num(v, d, props) { v = bind(v, props); return v == null || v === '' || isNaN(+v) ? d : +v; }
  function v3(v, d, props) { return vec(v, 3, d, props); }
  function PSys(L, props) { this.L = L; this.P = []; this.t = 0; this.reset(props); }
  PSys.prototype.reset = function (props) {
    var j = this.L.ps, ov = this.L.over || {};
    this.props = props;
    this.ov = { rate: num(ov.rate, 1, props), count: num(ov.count, 1, props), size: num(ov.size, 1, props), alpha: num(ov.alpha, 1, props), life: num(ov.lifetime, 1, props), speed: num(ov.speed, 1, props),
      col: ov.colorn != null ? v3(ov.colorn, [1, 1, 1], props) : ov.color != null ? v3(ov.color, [255, 255, 255], props).map(function (x) { return x / 255; }) : [1, 1, 1] };
    this.max = Math.max(1, Math.round(num(j.maxcount, 100) * this.ov.count));
    var self = this;
    this.em = (j.emitter || []).map(function (e) {
      return { name: e.name || 'boxrandom', rate: num(e.rate, 5) * self.ov.rate, dmin: v3(e.distancemin, [0, 0, 0]), dmax: v3(e.distancemax, [256, 256, 0]),
        origin: v3(e.origin, [0, 0, 0]), dir: v3(e.directions, [1, 1, 0]), inst: num(e.instantaneous, 0), acc: 0, done: false };
    });
    this.ini = j.initializer || []; this.ops = j.operator || [];
    if (!this.warm) { this.warm = 1; var st = Math.min(20, num(j.starttime, 0)); for (var k = 0; k < st * 15; k++) this.step(1 / 15); }
  };
  PSys.prototype.spawn = function (e) {
    if (this.P.length >= this.max) return;
    var p = { x: 0, y: 0, vx: 0, vy: 0, life: 1, age: 0, size: 20, a: 1, c: [1, 1, 1], rot: 0, av: 0, ox: 0, oy: 0, osc: null };
    if (e.name === 'sphererandom') { var an = Math.random() * Math.PI * 2, r = rnd(e.dmin[0], e.dmax[0]); p.x = Math.cos(an) * r * (e.dir[0] || 0); p.y = Math.sin(an) * r * (e.dir[1] || 0); }
    else { p.x = rnd(-e.dmax[0], e.dmax[0]); p.y = rnd(-e.dmax[1], e.dmax[1]); }
    p.x += e.origin[0]; p.y += e.origin[1];
    var pr = this.props;
    this.ini.forEach(function (n) {
      var nm = n.name;
      if (nm === 'lifetimerandom') p.life = rnd(num(n.min, 1, pr), num(n.max, 1, pr));
      else if (nm === 'sizerandom') p.size = rnd(num(n.min, 20, pr), num(n.max, 20, pr));
      else if (nm === 'alpharandom') p.a = rnd(num(n.min, 1, pr), num(n.max, 1, pr));
      else if (nm === 'velocityrandom') { var a = v3(n.min, [-32, -32, 0], pr), b = v3(n.max, [32, 32, 0], pr); p.vx = rnd(a[0], b[0]); p.vy = rnd(a[1], b[1]); }
      else if (nm === 'colorrandom') { var c0 = v3(n.min, [255, 255, 255], pr), c1 = v3(n.max, [255, 255, 255], pr), t = Math.random(); p.c = [0, 1, 2].map(function (i) { return (c0[i] + (c1[i] - c0[i]) * t) / 255; }); }
      else if (nm === 'rotationrandom') { var r0 = v3(n.min, [0, 0, 0], pr), r1 = v3(n.max, [0, 0, 6.28], pr); p.rot = rnd(r0[2], r1[2]); }
      else if (nm === 'angularvelocityrandom') { var w0 = v3(n.min, [0, 0, -5], pr), w1 = v3(n.max, [0, 0, 5], pr); p.av = rnd(w0[2], w1[2]); }
      else if (nm === 'turbulentvelocityrandom') { var sp = rnd(num(n.speedmin, 100, pr), num(n.speedmax, 250, pr)), ang = Math.random() * Math.PI * 2; p.vx += Math.cos(ang) * sp; p.vy += Math.sin(ang) * sp; }
    });
    p.life *= this.ov.life; p.size *= this.ov.size; p.a *= this.ov.alpha; p.vx *= this.ov.speed; p.vy *= this.ov.speed;
    p.a0 = p.a; p.s0 = p.size; p.c0 = p.c.slice();
    this.P.push(p);
  };
  PSys.prototype.step = function (dt) {
    var self = this; this.t += dt;
    this.em.forEach(function (e) {
      if (e.inst > 0) { if (!e.done) { for (var i = 0; i < e.inst; i++) self.spawn(e); e.done = true; } return; }
      e.acc += e.rate * dt; while (e.acc >= 1) { e.acc -= 1; self.spawn(e); }
    });
    var ops = this.ops, pr = this.props, P = this.P;
    for (var i = P.length - 1; i >= 0; i--) {
      var p = P[i]; p.age += dt; if (p.age >= p.life) { P.splice(i, 1); continue; }
      var f = p.age / p.life, a = p.a0, s = p.s0, c = p.c0, cm = null, ox = 0, oy = 0;
      for (var k = 0; k < ops.length; k++) {
        var o = ops[k], nm = o.name;
        if (nm === 'movement') { var g = v3(o.gravity, [0, 0, 0], pr), dr = num(o.drag, 0, pr); p.vx += g[0] * dt; p.vy += g[1] * dt; p.vx -= p.vx * Math.min(1, dr * dt); p.vy -= p.vy * Math.min(1, dr * dt); p.x += p.vx * dt; p.y += p.vy * dt; }
        else if (nm === 'angularmovement') { var ad = num(o.drag, 0, pr); p.av -= p.av * Math.min(1, ad * dt); p.rot += p.av * dt; }
        else if (nm === 'alphafade') { var fi = num(o.fadeintime, .5, pr), fo = num(o.fadeouttime, .5, pr); if (f < fi) a *= f / Math.max(1e-3, fi); if (f > fo) a *= (1 - f) / Math.max(1e-3, 1 - fo); }
        else if (nm === 'sizechange' || nm === 'alphachange') {
          var st = num(o.starttime, 0, pr), et = num(o.endtime, 1, pr), sv = num(o.startvalue, 1, pr), ev = num(o.endvalue, 0, pr), q = Math.max(0, Math.min(1, (f - st) / Math.max(1e-3, et - st))), m = sv + (ev - sv) * q;
          if (nm === 'sizechange') s *= m; else a *= m;
        }
        else if (nm === 'colorchange') { var cs = v3(o.startvalue, [1, 1, 1], pr), ce = v3(o.endvalue, [1, 1, 1], pr), cq = Math.max(0, Math.min(1, (f - num(o.starttime, 0, pr)) / Math.max(1e-3, num(o.endtime, 1, pr) - num(o.starttime, 0, pr)))); cm = [0, 1, 2].map(function (j) { return cs[j] + (ce[j] - cs[j]) * cq; }); }
        else if (nm === 'oscillateposition' || nm === 'oscillatealpha' || nm === 'oscillatesize') {
          var os = p.osc || (p.osc = {}), key = nm;
          if (!os[key]) os[key] = { fx: rnd(num(o.frequencymin, 0, pr), num(o.frequencymax, 5, pr)), fy: rnd(num(o.frequencymin, 0, pr), num(o.frequencymax, 5, pr)),
            sx: rnd(num(o.scalemin, 0, pr), num(o.scalemax, 1, pr)), sy: rnd(num(o.scalemin, 0, pr), num(o.scalemax, 1, pr)), px: Math.random() * 6.283, py: Math.random() * 6.283 };
          var Q = os[key];
          if (nm === 'oscillateposition') { var mk = v3(o.mask, [1, 1, 0], pr); ox += Math.sin(p.age * Q.fx + Q.px) * Q.sx * mk[0]; oy += Math.sin(p.age * Q.fy + Q.py) * Q.sy * mk[1]; }
          else if (nm === 'oscillatealpha') a *= 1 - Q.sx * (.5 + .5 * Math.sin(p.age * Q.fx + Q.px));
          else s *= 1 - Q.sx * (.5 + .5 * Math.sin(p.age * Q.fx + Q.px));
        }
        else if (nm === 'turbulence') {
          var sc = num(o.scale, .005, pr), ts = num(o.timescale, 1, pr), spd = rnd(num(o.speedmin, 100, pr), num(o.speedmax, 250, pr)) * .25;
          var ang = (Math.sin(p.x * sc + self.t * ts) + Math.cos(p.y * sc * 1.3 - self.t * ts * .7)) * Math.PI;
          p.vx += Math.cos(ang) * spd * dt; p.vy += Math.sin(ang) * spd * dt;
        }
      }
      p.da = Math.max(0, a); p.ds = Math.max(0, s); p.dc = cm ? [c[0] * cm[0], c[1] * cm[1], c[2] * cm[2]] : c; p.ox = ox; p.oy = oy;
    }
  };

  var assetPool = new WallRuntime.AssetPool(2);
  /* ---------- 渲染器：一块画布画一段图层 ---------- */
  function Renderer(canvas, scene, layers, opt) {
    opt = opt || {};
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: !!opt.keep });
    if (!gl) throw new Error('这台设备不支持 WebGL');
    this.gl = gl; this.canvas = canvas; this.scene = scene; this.layers = layers; this.opt = opt; this.S = scene.size();
    this.focus = opt.focus || [0.5, 0.5]; this.zoom = opt.zoom || 1; this.clearCol = opt.clear ? scene.clear() : null;
    this.props = Object.assign(scene.defaults(), opt.props || {}); this.audio = opt.audio || null; this.fxq = opt.fxq || 1;
    var q = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, q); this.quad = q; this.pbuf = gl.createBuffer();
    this.base = this.prog(
      'attribute vec2 p; attribute vec2 t; uniform mat3 M; varying vec2 v; void main(){ vec3 q = M * vec3(p, 1.0); gl_Position = vec4(q.xy, 0.0, 1.0); v = t; }',
      // 5.10 水波：uR = (圆心 x, y（画布像素，y 朝上）, 波前半径, 已过秒数；<0 = 关)，uTx = 每个屏幕像素对应多少纹理坐标
      'precision mediump float; uniform sampler2D s; uniform vec4 c; uniform float solid; uniform vec4 uR; uniform vec2 uTx; uniform vec4 uSF; uniform float uSn; uniform vec4 uS[24]; uniform vec4 uCA; uniform float uCAon; varying vec2 v;' +
      // 5.11 WE 的「颜色选项」：亮度 / 对比度 / 饱和度 / 色相（-1..1，0 = 不变）
      'vec3 ydCA(vec3 x){ x *= exp2(uCA.x); x = (x - 0.5) * exp2(uCA.y * 1.2) + 0.5; float l = dot(x, vec3(0.299, 0.587, 0.114)); x = mix(vec3(l), x, 1.0 + uCA.z);' +
      ' float a = uCA.w * 3.14159; vec3 yiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * x; yiq.yz = mat2(cos(a), sin(a), -sin(a), cos(a)) * yiq.yz;' +
      ' return clamp(mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * yiq, 0.0, 1.0); }' +
      'void main(){ vec2 uv = v; float sh = 1.0;' +
      // 5.10 水光束：一组斜着的透明光束，像水做的透镜，把壁纸往两边推一点、边上亮一点（uSF = 中心 x, y, 法线 x, y；uS[i] = 位置, 半宽, 强度）
      ' if (uSn > 0.0) { vec2 n = uSF.zw; float xp = dot(gl_FragCoord.xy - uSF.xy, n); vec2 dsp = vec2(0.0);' +
      '  for (int i = 0; i < 24; i++) { if (float(i) >= uSn) break; vec4 S = uS[i]; float d = xp - S.x; if (abs(d) < S.y) { float q = d / S.y; dsp += n * sin(q * 3.14159) * S.z * S.y * 0.32; sh += S.z * (0.06 * (1.0 - q * q) + 0.22 * smoothstep(0.78, 1.0, abs(q))); } }' +
      '  uv += vec2(dsp.x, -dsp.y) * uTx; }' +
      ' if (uR.w >= 0.0) { vec2 d = gl_FragCoord.xy - uR.xy; float r = length(d) + 0.001; float b = uR.z - r;' +
      '  if (b > 0.0) { float env = exp(-b / 230.0) * exp(-uR.w * 1.5); float w = sin(b * 0.05) * env; uv += vec2(d.x, -d.y) / r * w * 16.0 * uTx; sh = 1.0 + 0.12 * w; } }' +
      ' vec4 k = solid > 0.5 ? vec4(1.0) : texture2D(s, uv); vec3 o = k.rgb * c.rgb * sh; if (uCAon > 0.5) o = ydCA(o); gl_FragColor = vec4(o, k.a * c.a); }');
    // 粒子：每个粒子一个小方块（位置已经换算成画布坐标），颜色 × 透明度 × 贴图
    this.pprog = this.prog('attribute vec2 p; attribute vec2 t; attribute vec4 k; varying vec2 v; varying vec4 w; void main(){ gl_Position = vec4(p, 0.0, 1.0); v = t; w = k; }',
      'precision mediump float; uniform sampler2D s; varying vec2 v; varying vec4 w; void main(){ vec4 x = texture2D(s, v); gl_FragColor = vec4(x.rgb * w.rgb, x.a * w.a); }');
    this.rip = null;
    this.white = this.tex1(BUILTIN['util/white']);
    this.texCache = {}; this.pv = 1; this.lastT = null;
    this.flip = !!opt.flip; this.ca = opt.ca || null; this.align = opt.align || 'free'; this.pan = 0;
  }
  Renderer.prototype.setProps = function (p) {
    var self = this; this.props = Object.assign(this.scene.defaults(), p || {}); this.pv++;
    this.layers.forEach(function (L) { if (L.sys) L.sys.reset(self.props); });
  };
  Renderer.prototype.on = function (L) { return truthy(bind(L.vis == null ? true : L.vis, this.props)); };
  Renderer.prototype.prog = function (vs, fs) {
    var gl = this.gl;
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(o); gl.deleteShader(o); throw new Error(e); } return o; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.loc = {}; p.U = function (n) { return n in p.loc ? p.loc[n] : (p.loc[n] = gl.getUniformLocation(p, n)); };
    return p;
  };
  // 5.8.1 不等编译结果：有 KHR_parallel_shader_compile 就让显卡驱动在后台编，隔一帧问一次好了没有（主线程不再干等几百毫秒）
  Renderer.prototype.progAsync = function (vs, fs) {
    var gl = this.gl, ext = gl.getExtension('KHR_parallel_shader_compile');
    function sh(t, src) { var o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return o; }
    var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs), p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    // 没有这个扩展：也先别问结果（一问就得等显卡进程编完），过一会儿再问，编译和主线程的活能重叠一部分
    return new Promise(function (ok, no) {
      var t0 = performance.now();
      (function poll() {
        if (gl.isContextLost()) return no(new Error('context lost'));
        if (ext ? !gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR) && performance.now() - t0 < 20000 : performance.now() - t0 < 40) return setTimeout(poll, 16);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
          var e = (gl.getShaderInfoLog(f) || '') + (gl.getShaderInfoLog(v) || '') + (gl.getProgramInfoLog(p) || '');
          gl.deleteProgram(p); return no(new Error(e || 'link failed'));
        }
        p.loc = {}; p.U = function (n) { return n in p.loc ? p.loc[n] : (p.loc[n] = gl.getUniformLocation(p, n)); };
        ok(p);
      })();
    });
  };
  Renderer.prototype.tex1 = function (c) { var gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(c)); this.params(); return { t: t, w: 1, h: 1, iw: 1, ih: 1, crop: [0, 0, 1, 1] }; };
  Renderer.prototype.params = function () { var gl = this.gl; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); };
  Renderer.prototype.upload = function (t, doCrop, pad) {  // → {t, w, h, iw, ih, crop:[u0,v0,du,dv]}
    if (this.disposed) { if (t.image && t.image.close) t.image.close(); throw new Error('wallpaper replaced'); }
    var gl = this.gl, tx = gl.createTexture(), crop = [0, 0, 1, 1], w = t.w, h = t.h;
    gl.bindTexture(gl.TEXTURE_2D, tx); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (t.image) { try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.image); } finally { if (t.image.close) t.image.close(); } }
    else {
      var px = t.data, b = doCrop && w * h > 600000 ? ('box' in t ? t.box || null : bbox(px, w, h)) : null;
      if (b && pad) { var pw = Math.round(w * pad), ph = Math.round(h * pad); b = [Math.max(0, b[0] - pw), Math.max(0, b[1] - ph), Math.min(w, b[2] + pw), Math.min(h, b[3] + ph)]; }  // 特效会把内容挪出原来的范围
      if (b && (b[2] - b[0]) * (b[3] - b[1]) < w * h * .8) { px = sub(px, w, b); crop = [b[0] / w, b[1] / h, (b[2] - b[0]) / w, (b[3] - b[1]) / h]; w = b[2] - b[0]; h = b[3] - b[1]; }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    this.params();
    return { t: tx, w: w, h: h, iw: t.iw, ih: t.ih, crop: crop };
  };
  Renderer.prototype.halo = function () {          // WE 自带的 particle/halo：柔和的圆光点
    if (this.texCache['particle/halo']) return this.texCache['particle/halo'];
    var n = 64, px = new Uint8Array(n * n * 4);
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) { var dx = (x + .5) / n * 2 - 1, dy = (y + .5) / n * 2 - 1, r = Math.min(1, Math.sqrt(dx * dx + dy * dy)), a = Math.pow(1 - r, 2.2), i = (y * n + x) * 4; px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = Math.round(a * 255); }
    return (this.texCache['particle/halo'] = this.upload({ w: n, h: n, iw: n, ih: n, data: px }, false));
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
    if (name === 'particle/halo') return Promise.resolve(this.halo());
    if (BUILTIN[name]) return Promise.resolve(this.texCache[name] || (this.texCache[name] = this.tex1(BUILTIN[name])));
    var p = 'materials/' + name + '.tex'; if (!this.scene.files[p]) return Promise.resolve(null);
    if (this.texCache[p]) return Promise.resolve(this.texCache[p]);
    return (this.texCache[p] = assetPool.run(function () { return readAsset(self.scene.files[p]).then(function (b) { return readTexBg(b); }).then(function (t) { return (self.texCache[p] = self.upload(t, false)); }); }));
  };
  Renderer.prototype.fbo = function (w, h) {
    var gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); this.params();
    var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { f: f, t: t, w: w, h: h };
  };
  Renderer.prototype.fboFit = function (o, w, h) {   // 尺寸变了才重建
    if (o && o.w === w && o.h === h) return o;
    if (o) { this.gl.deleteFramebuffer(o.f); this.gl.deleteTexture(o.t); }
    return this.fbo(w, h);
  };
  // 编一个特效步骤：组合开关、要用到的贴图、材质里的数值（数值留着绑定，画的时候按设置取）
  Renderer.prototype.compilePass = function (L, E, ps) {
    var self = this, sv = scan(ps.vs), sf = scan(ps.fs), defs = {}, k;
    for (k in sv.combos) defs[k] = sv.combos[k]; for (k in sf.combos) defs[k] = sf.combos[k];
    for (k in ps.combos) defs[k] = ps.combos[k] | 0;
    var unis = sv.unis.concat(sf.unis), texNames = [];
    unis.forEach(function (u) {
      var m = /^g_Texture(\d)$/.exec(u.name); if (!m) return; var n = +m[1];
      if (ps.bind[n]) { texNames[n] = null; if (u.meta.combo) defs[u.meta.combo] = 1; return; }
      var nm = ps.textures[n] != null ? ps.textures[n] : ps.mtex[n] != null ? ps.mtex[n] : (u.meta.default || null); texNames[n] = n === 0 ? null : nm;
      if (u.meta.combo) defs[u.meta.combo] = (ps.textures[n] || ps.mtex[n]) ? 1 : 0;
    });
    if (!this.audio) defs.AUDIOPROCESSING = 0;
    var src = [translate(ps.vs, defs, false), translate(ps.fs, defs, true)];
    return this.progAsync(src[0], src[1]).then(function (P) {
      var ul = [];
      unis.forEach(function (u) { if (/^g_Texture/.test(u.name) || !u.meta.material && u.meta.default == null) return; ul.push({ n: u.name, type: u.type, mat: u.meta.material, def: u.meta.default }); });
      return Promise.all(texNames.map(function (nm) { return nm ? self.loadTex(nm) : null; })).then(function (ts) {
        return { P: P, ul: ul, consts: ps.consts, tex: ts, bind: ps.bind, target: ps.target, vals: null, vpv: 0 };
      });
    });
  };
  Renderer.prototype.load = function () {        // 解码贴图、编译特效（逐层异步，不一次卡死）
    var self = this, warn = this.warn = [];
    // 5.8.1 流水线：所有贴图先排进后台线程解码；每层解完就上传、特效送去编译（不等上一层编完）
    var fxAll = []; // 每层按需解码、上传完成再让出槽位，避免所有 RGBA 解码结果同时驻留。
    function compileFx(L) {
      fxAll.push(Promise.all(L.effects.map(function (E) {
        return Promise.all(E.passes.map(function (ps) {
          if (ps.command) return Promise.resolve({ command: ps.command, source: ps.source, target: ps.target });
          var pr; try { pr = self.compilePass(L, E, ps); } catch (err) { pr = Promise.reject(err); }
          return pr;
        })).then(function (passes) { return { E: E, passes: passes, fb: {} }; }, function (err) {
          warn.push(L.name + ' · ' + E.file + '：' + String(err.message || err).slice(0, 200));
          if (/blur|bloom|glow/i.test(E.file)) L.drop = 1;   // 靠模糊/辉光才成立的层：特效还原不了就整层不画（不然会露出生硬的原图）
          return null; });
      })).then(function (list) { L.fx = list.filter(Boolean); }));
    }
    return this.layers.reduce(function (pr, L, li) {
      return pr.then(function () {
        if (self.disposed) throw new Error('wallpaper replaced');
        if (L.kind === 'solid') { L.gtex = self.white; if (!L.size) L.size = [1, 1]; return; }
        if (L.kind === 'particle') { L.sys = new PSys(L, self.props); return self.loadTex(L.ptex).then(function (T) { L.gtex = T || self.halo(); }); }
        if (L.kind === 'capture') { L.gtex = { t: null, w: 1, h: 1, iw: L.size[0], ih: L.size[1], crop: [0, 0, 1, 1] }; L.fx = []; compileFx(L); return; }
        return assetPool.run(function () { return readAsset(self.scene.files[L.tex]).then(function (b) { return readTexBg(b, true); }).then(function (t) {
          L.gtex = self.upload(t, !L.effects.length, 0);
          if (!L.size) L.size = [t.iw, t.ih];
        }); }).then(function () { L.fx = []; compileFx(L); });
      }).then(function () { return new Promise(function (r) { setTimeout(r, 0); }); });   // 每层之间让一下主线程
    }, Promise.resolve()).then(function () { return Promise.all(fxAll); }).then(function () { self.ready = true; return self; });
  };
  // 视口：场景里要显示的那一块（竖屏裁横版壁纸：按高度铺满，焦点决定左右）
  Renderer.prototype.view = function () {
    var cw = this.canvas.width, ch = this.canvas.height, W = this.S[0], H = this.S[1], a = cw / ch;
    if (this.align === 'fill') return [0, 0, W, H];   // 5.11 拉伸：整张画面压进屏幕
    var vh = H / this.zoom, vw = vh * a; if (vw > W / this.zoom) { vw = W / this.zoom; vh = vw / a; }
    var x0 = Math.max(0, Math.min(W - vw, (this.focus[0] + (this.pan || 0)) * W - vw / 2)), y0 = Math.max(0, Math.min(H - vh, (1 - this.focus[1]) * H - vh / 2));
    return [x0, y0, vw, vh];   // y0 从下往上（场景坐标 y 朝上）
  };
  // 5.11 特效只处理屏幕上看得见的那一块（再留一圈余量，摇晃会把旁边的内容挪进来）：横版壁纸在竖屏上只露出三成，省七成的活
  Renderer.prototype.region = function (L, vw) {
    var c = L.gtex.crop, cr = [c[0], c[1], c[0] + c[2], c[1] + c[3]];
    if (L.kind === 'capture') {
      var W = this.S[0], H = this.S[1]; return [vw[0] / W, (H - vw[1] - vw[3]) / H, vw[2] / W, vw[3] / H];
    }
    if (L.angles[2]) return [c[0], c[1], c[2], c[3]];
    var sw = L.size[0] * L.scale[0], sh = L.size[1] * L.scale[1], left = L.origin[0] - sw / 2, top = L.origin[1] + sh / 2;
    var m = .06, q = 32;
    var u0 = Math.floor(((vw[0] - left) / sw - m) * q) / q, u1 = Math.ceil(((vw[0] + vw[2] - left) / sw + m) * q) / q;
    var v0 = Math.floor(((top - vw[1] - vw[3]) / sh - m) * q) / q, v1 = Math.ceil(((top - vw[1]) / sh + m) * q) / q;
    u0 = Math.max(u0, cr[0]); v0 = Math.max(v0, cr[1]); u1 = Math.min(u1, cr[2]); v1 = Math.min(v1, cr[3]);
    if (u1 <= u0 || v1 <= v0) return null;
    return [u0, v0, u1 - u0, v1 - v0];
  };
  Renderer.prototype.passVals = function (F) {
    if (F.vals && F.vpv === this.pv) return F.vals;
    var props = this.props;
    F.vals = F.ul.map(function (u) {
      var raw = u.mat && F.consts[u.mat] != null ? F.consts[u.mat] : u.def;
      return { n: u.n, type: u.type, v: raw == null ? null : vec(raw, 4, [0, 0, 0, 0], props) };
    }).filter(function (x) { return x.v; });
    F.vpv = this.pv; return F.vals;
  };
  Renderer.prototype.runFx = function (L, time, vw, A) {
    var gl = this.gl, self = this, fx = (L.fx || []).filter(function (F) { return truthy(bind(F.E.vis == null ? true : F.E.vis, self.props)); });
    L.out = L.gtex; L.reg = null;
    if (!fx.length && L.kind !== 'capture') return true;
    var R = this.region(L, vw); if (!R) return false;
    var texPU = (L.gtex.iw || L.gtex.w) / (L.size[0] * L.scale[0]), pxPU = this.canvas.height / vw[3];
    var s = Math.min(1, pxPU / Math.max(1e-6, texPU) * this.fxq);
    var iw = L.gtex.iw || L.gtex.w, ih = L.gtex.ih || L.gtex.h;
    var W = Math.max(8, Math.ceil(R[2] * iw * s)), H = Math.max(8, Math.ceil(R[3] * ih * s));
    L.pp = L.pp || [null, null]; L.pp[0] = this.fboFit(L.pp[0], W, H); L.pp[1] = this.fboFit(L.pp[1], W, H);
    var flipR = [R[0], R[1] + R[3], R[2], -R[3]];
    var cur = { t: L.gtex.t, crop: L.kind === 'capture' ? flipR : L.gtex.crop, iw: iw, ih: ih, fb: null };
    var quad = [-1, -1, R[0], R[1] + R[3], 1, -1, R[0] + R[2], R[1] + R[3], -1, 1, R[0], R[1], 1, 1, R[0] + R[2], R[1]];
    var day = (function () { var d = new Date(); return (d.getHours() * 60 + d.getMinutes()) / 1440; })();
    fx.forEach(function (F) {
      var named = {};
      F.E.fbos.forEach(function (f) { F.fb[f.name] = self.fboFit(F.fb[f.name], Math.max(4, Math.ceil(W / f.scale)), Math.max(4, Math.ceil(H / f.scale))); named[f.name] = { t: F.fb[f.name].t, fb: F.fb[f.name], crop: flipR, iw: iw / f.scale, ih: ih / f.scale }; });
      function src(name) { return !name || name === 'previous' ? cur : named[name] || cur; }
      F.passes.forEach(function (ps) {
        if (ps.command) {   // copy / swap：只支持 copy 到具名缓冲
          if (ps.command === 'copy' && named[ps.target]) self.blit(src(ps.source), named[ps.target].fb, quad);
          return;
        }
        var out = ps.target && named[ps.target] ? named[ps.target].fb : (cur.fb === L.pp[0] ? L.pp[1] : L.pp[0]);
        var P = ps.P;
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.f); gl.viewport(0, 0, out.w, out.h); gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(P);
        self.quadData(quad, P);
        var I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        ['g_ModelViewProjectionMatrix', 'g_EffectTextureProjectionMatrix', 'g_EffectTextureProjectionMatrixInverse'].forEach(function (n) { var l = P.U(n); if (l) gl.uniformMatrix4fv(l, false, I4); });
        gl.uniform1f(P.U('g_Time'), time);
        if (P.U('g_Daytime')) gl.uniform1f(P.U('g_Daytime'), day);
        if (P.U('g_PointerPosition')) gl.uniform2f(P.U('g_PointerPosition'), .5, .5);
        if (P.U('g_ParallaxPosition')) gl.uniform2f(P.U('g_ParallaxPosition'), .5, .5);
        if (P.U('g_Screen')) gl.uniform3f(P.U('g_Screen'), self.canvas.width, self.canvas.height, self.canvas.width / self.canvas.height);
        if (P.U('g_Texture0Rotation')) gl.uniform4f(P.U('g_Texture0Rotation'), 1, 0, 0, 1);
        if (P.U('g_Texture0Translation')) gl.uniform2f(P.U('g_Texture0Translation'), 0, 0);
        if (A) [16, 32, 64].forEach(function (n) { var l = P.U('g_AudioSpectrum' + n + 'Left'), r = P.U('g_AudioSpectrum' + n + 'Right'); if (l) gl.uniform1fv(l, A['l' + n]); if (r) gl.uniform1fv(r, A['r' + n]); });
        self.passVals(ps).forEach(function (u) { var l = P.U(u.n); if (!l) return; var v = u.v;
          if (u.type === 'float') gl.uniform1f(l, v[0]); else if (u.type === 'vec2') gl.uniform2f(l, v[0], v[1]); else if (u.type === 'vec3') gl.uniform3f(l, v[0], v[1], v[2]); else if (u.type === 'vec4') gl.uniform4f(l, v[0], v[1], v[2], v[3]); else if (u.type === 'int') gl.uniform1i(l, v[0] | 0); });
        for (var n = 0; n < 8; n++) {
          var T = ps.bind[n] || n === 0 ? src(ps.bind[n]) : ps.tex[n];
          if (!T && !P.U('g_Texture' + n)) continue; T = T || self.white;
          gl.activeTexture(gl.TEXTURE0 + n); gl.bindTexture(gl.TEXTURE_2D, T.t); gl.uniform1i(P.U('g_Texture' + n), n);
          var tw = T.iw || T.w, th = T.ih || T.h;
          gl.uniform4f(P.U('g_Texture' + n + 'Resolution'), tw, th, tw, th);
          if (n === 0 && P.U('g_TexelSize')) gl.uniform2f(P.U('g_TexelSize'), 1 / tw, 1 / th);
          var cr = T.crop || [0, 0, 1, 1]; gl.uniform4f(P.U('ydCrop' + n), cr[0], cr[1], cr[2], cr[3]);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (!ps.target) cur = { t: out.t, fb: out, crop: flipR, iw: iw, ih: ih };
      });
    });
    L.out = cur.fb ? cur : L.gtex; L.reg = cur.fb ? R : null;
    return true;
  };
  Renderer.prototype.blit = function (from, to, quad) {      // 原样拷到另一块缓冲（effect 里的 copy 命令）
    var gl = this.gl, P = this.base;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.f); gl.viewport(0, 0, to.w, to.h); gl.disable(gl.BLEND); gl.useProgram(P);
    var c = from.crop || [0, 0, 1, 1], q = quad.slice();
    for (var i = 0; i < 16; i += 4) { q[i + 2] = (q[i + 2] - c[0]) / c[2]; q[i + 3] = (q[i + 3] - c[1]) / c[3]; }
    this.quadData(q, P, true); gl.uniformMatrix3fv(P.U('M'), false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, from.t); gl.uniform1i(P.U('s'), 0); gl.uniform1f(P.U('solid'), 0);
    gl.uniform1f(P.U('uSn'), 0); gl.uniform4f(P.U('uR'), 0, 0, 0, -1); gl.uniform4f(P.U('c'), 1, 1, 1, 1); gl.uniform1f(P.U('uCAon'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  Renderer.prototype.draw = function (time) {
    if (!this.ready) return;
    var gl = this.gl, self = this, vw = this.view(), cw = this.canvas.width, ch = this.canvas.height;
    var dt = this.lastT == null ? 0 : Math.max(0, Math.min(.1, time - this.lastT)); this.lastT = time;
    var A = this.audio ? this.audio() : null;
    var vis = this.layers.filter(function (L) { return L.gtex && !L.drop && self.on(L); });
    // 1) 普通图层的特效先跑完（结果留在各自的帧缓冲里）
    vis.forEach(function (L) { if (L.kind === 'image') L.offscreen = !self.runFx(L, time, vw, A); else if (L.kind !== 'capture') { L.out = L.gtex; L.reg = null; } });
    // 2) 合成。有「抓背景」的合成层时先画进一块离屏缓冲，抓完再拷到画布
    var cap = vis.some(function (L) { return L.kind === 'capture'; });
    if (cap) { this.sceneFb = this.fboFit(this.sceneFb, cw, ch); gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFb.f); }
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    var cc = this.clearCol; gl.clearColor(cc ? cc[0] : 0, cc ? cc[1] : 0, cc ? cc[2] : 0, cc ? 1 : 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    vis.forEach(function (L) {
      if (L.offscreen) return;
      var alpha = num(L.alphaR, 1, self.props), col = vec(L.colorR, 3, [1, 1, 1], self.props);
      if (L.kind === 'particle') { self.drawParticles(L, dt, vw, alpha); return; }
      if (L.kind === 'capture') {
        var ct = L.capT = self.capTex(L.capT, cw, ch);
        gl.bindTexture(gl.TEXTURE_2D, ct.t); gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
        L.gtex.t = ct.t;
        self.runFx(L, time, vw, A);
        gl.bindFramebuffer(gl.FRAMEBUFFER, self.sceneFb.f); gl.viewport(0, 0, cw, ch); gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        var P0 = self.base; gl.useProgram(P0);
        self.quadData([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1], P0, true);
        self.baseUni(P0, L.out.t, 0, col, alpha, null, false, false);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return;
      }
      if (L.blend === 'additive') gl.blendFunc(gl.SRC_ALPHA, gl.ONE); else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      var P = self.base; gl.useProgram(P);
      var sw = L.size[0] * L.scale[0], sh = L.size[1] * L.scale[1], c = L.reg || L.gtex.crop;
      // 图层四个角（场景坐标，y 朝上），只画有内容（或处理过）的那一块
      var ax = -sw / 2 + c[0] * sw, bx = ax + c[2] * sw, ay = sh / 2 - c[1] * sh, by = ay - c[3] * sh;
      var r = -(L.angles[2] || 0), cs = Math.cos(r), sn = Math.sin(r), ox = L.origin[0], oy = L.origin[1];
      var fl = self.flip ? -1 : 1;   // 5.11 翻转：左右镜像
      function pt(x, y) { var X = ox + x * cs - y * sn, Y = oy + x * sn + y * cs; return [fl * ((X - vw[0]) / vw[2] * 2 - 1), (Y - vw[1]) / vw[3] * 2 - 1]; }
      var p0 = pt(ax, by), p1 = pt(bx, by), p2 = pt(ax, ay), p3 = pt(bx, ay);
      var fx = L.out !== L.gtex;   // 帧缓冲里的结果是倒过来的
      self.quadData(fx ? [p0[0], p0[1], 0, 0, p1[0], p1[1], 1, 0, p2[0], p2[1], 0, 1, p3[0], p3[1], 1, 1] : [p0[0], p0[1], 0, 1, p1[0], p1[1], 1, 1, p2[0], p2[1], 0, 0, p3[0], p3[1], 1, 0], P, true);
      self.baseUni(P, L.out.t, L.kind === 'solid' ? 1 : 0, col, alpha, [p0, p1, p2], false, !cap);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
    if (cap) {   // 离屏结果拷到画布
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cw, ch); gl.disable(gl.BLEND);
      var Pb = this.base; gl.useProgram(Pb);
      this.quadData([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1], Pb, true);
      this.baseUni(Pb, this.sceneFb.t, 0, [1, 1, 1], 1, null, true, true);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };
  Renderer.prototype.capTex = function (o, w, h) {
    if (o && o.w === w && o.h === h) return o;
    var gl = this.gl; if (o) gl.deleteTexture(o.t);
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); this.params();
    return { t: t, w: w, h: h };
  };
  // 基础着色器的公共参数；pts = 图层在画布上的三个角（水波 / 水光束要用），noFx = 最后拷屏时不再加启动动画的效果
  Renderer.prototype.baseUni = function (P, tex, solid, col, alpha, pts, noFx, ca) {
    var gl = this.gl, C = ca && this.ca;
    gl.uniform1f(P.U('uCAon'), C ? 1 : 0); if (C) gl.uniform4f(P.U('uCA'), C[0], C[1], C[2], C[3]);
    gl.uniformMatrix3fv(P.U('M'), false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(P.U('s'), 0);
    gl.uniform1f(P.U('solid'), solid);
    var rp = noFx ? null : this.rip, sf = noFx ? null : this.sf;   // 水波 / 水光束（启动动画落到首页时）
    if (sf) { gl.uniform4f(P.U('uSF'), sf.c[0], sf.c[1], sf.c[2], sf.c[3]); gl.uniform1f(P.U('uSn'), sf.n); gl.uniform4fv(P.U('uS[0]') || P.U('uS'), sf.s); } else gl.uniform1f(P.U('uSn'), 0);
    if (rp) gl.uniform4f(P.U('uR'), rp[0], rp[1], rp[2], rp[3]); else gl.uniform4f(P.U('uR'), 0, 0, 0, -1);
    if (rp || sf) { var p0 = pts ? pts[0] : [-1, -1], p1 = pts ? pts[1] : [1, -1], p2 = pts ? pts[2] : [-1, 1];
      gl.uniform2f(P.U('uTx'), 2 / Math.max(1, Math.abs(p1[0] - p0[0]) * this.canvas.width), 2 / Math.max(1, Math.abs(p2[1] - p0[1]) * this.canvas.height)); }
    gl.uniform4f(P.U('c'), col[0], col[1], col[2], alpha);
  };
  Renderer.prototype.drawParticles = function (L, dt, vw, alpha) {
    var S = L.sys; if (!S) return; S.step(dt);
    var P = S.P, n = P.length; if (!n) return;
    var gl = this.gl, d = this.pdata && this.pdata.length >= n * 48 ? this.pdata : (this.pdata = new Float32Array(Math.max(n, 64) * 48));
    var r = -(L.angles[2] || 0), cs = Math.cos(r), sn = Math.sin(r), ox = L.origin[0], oy = L.origin[1], sx = L.scale[0], sy = L.scale[1], oc = S.ov.col, k = 0;
    var kx = 2 / vw[2], ky = 2 / vw[3];
    var UV = [[0, 1], [1, 1], [0, 0], [0, 0], [1, 1], [1, 0]], CN = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];
    for (var i = 0; i < n; i++) {
      var p = P[i], lx = (p.x + p.ox) * sx, ly = (p.y + p.oy) * sy, X = ox + lx * cs - ly * sn, Y = oy + lx * sn + ly * cs;
      var cx = ((X - vw[0]) * kx - 1) * (this.flip ? -1 : 1), cy = (Y - vw[1]) * ky - 1, hs = p.ds, rc = Math.cos(p.rot), rs = Math.sin(p.rot), a = p.da * alpha, c = p.dc;
      for (var j = 0; j < 6; j++) {
        var qx = CN[j][0] * hs, qy = CN[j][1] * hs;
        d[k++] = cx + (qx * rc - qy * rs) * kx; d[k++] = cy + (qx * rs + qy * rc) * ky; d[k++] = UV[j][0]; d[k++] = UV[j][1];
        d[k++] = c[0] * oc[0]; d[k++] = c[1] * oc[1]; d[k++] = c[2] * oc[2]; d[k++] = a;
      }
    }
    var Pp = this.pprog; gl.useProgram(Pp);
    if (L.blend === 'additive') gl.blendFunc(gl.SRC_ALPHA, gl.ONE); else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf); gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, k), gl.DYNAMIC_DRAW);
    var ap = gl.getAttribLocation(Pp, 'p'), at = gl.getAttribLocation(Pp, 't'), ak = gl.getAttribLocation(Pp, 'k');
    gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(ak); gl.vertexAttribPointer(ak, 4, gl.FLOAT, false, 32, 16);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, L.gtex.t); gl.uniform1i(Pp.U('s'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, n * 6);
    gl.disableVertexAttribArray(ak);
  };
  Renderer.prototype.quadData = function (d, P, base) {
    var gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d), gl.DYNAMIC_DRAW);
    var a = gl.getAttribLocation(P, base ? 'p' : 'a_Position'), b = gl.getAttribLocation(P, base ? 't' : 'a_TexCoord');
    if (a >= 0) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 16, 0); }
    if (b >= 0) { gl.enableVertexAttribArray(b); gl.vertexAttribPointer(b, 2, gl.FLOAT, false, 16, 8); }
  };
  Renderer.prototype.destroy = function () { this.disposed = true; var e = this.gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); };
  Renderer.prototype.usesAudio = function () {   // 有特效要听声音（组合开关 AUDIOPROCESSING 开着）
    return this.layers.some(function (L) { return (L.effects || []).some(function (E) { return E.passes.some(function (p) { return ((p.combos && p.combos.AUDIOPROCESSING) | 0) > 0; }); }); });
  };

  /* ---------- 景深：哪些层在字后面 ---------- */
  function splitIndex(layers, S) {
    // 从下往上，连续的“铺满全屏的不透明层”算背景；其余在字前面
    var k = 0;
    for (var i = 0; i < layers.length; i++) { var L = layers[i], sw = (L.size ? L.size[0] : 0) * L.scale[0], sh = (L.size ? L.size[1] : 0) * L.scale[1];
      if (L.kind !== 'particle' && L.kind !== 'capture' && !L.solid && L.kind !== 'solid' && sw >= S[0] * .95 && sh >= S[1] * .95 && (!L.gtex || L.gtex.crop[2] > .95)) k = i + 1; else break; }
    return Math.max(1, k);
  }
  // 5.11 拆成前后两段：抓背景的合成层必须和背景在同一块画布上（不然抓不到），挪到后面那段
  function split(layers, S) {
    var k = splitIndex(layers, S), back = layers.slice(0, k), front = [];
    layers.slice(k).forEach(function (L) { (L.kind === 'capture' ? back : front).push(L); });
    return [back, front];
  }

  /* ---------- 5.13 写实小雨：屏幕这块玻璃上的水 ----------
   * 一块透明画布盖在壁纸上面、界面下面。玻璃上的水照 Codrops RainEffect 的模拟：
   * 大水珠随机变重往下流、左右拐，身后留一串小水珠；碰到别的水珠合并、流得更快；流过的地方把细水雾和起雾擦清，雾再慢慢回来。
   * 水面图（2D）：R/G = 法线，B = 厚度，A = 形状。着色器里每颗水珠当一个小凸透镜：里面是倒过来缩小、清楚的壁纸，暗边、高光、下沿一弯亮。
   * 窗外有一层细雨丝；近处雨点偶尔砸到玻璃上，溅开一圈小水珠。壁纸来自调用方的 paint(ctx, w, h)（Worker 里是两块壁纸画布，主线程可以是视频 / 图片）。 */
  function rainCanvas(w, h) { var c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0)) : document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
  var RAIN_FS = [
    'precision mediump float;',
    'varying vec2 uv;',
    'uniform sampler2D uSharp, uBlur, uWater, uClr, uPart;',
    'uniform vec2 uRes; uniform float uFog, uDark, uAlpha;',
    'void main(){',
    '  vec4 w = texture2D(uWater, uv);',
    '  float a = clamp(w.a * 5.0 - 2.4, 0.0, 1.0);',
    '  vec2 n = (w.rg - 0.5) * 2.0; float h = w.b;',
    '  float cl = smoothstep(0.0, 0.45, texture2D(uClr, uv).a);',
    // 窗外的雨丝（预乘）→ 一点阴雨天的冷暗 → 起雾（被流下的水擦开的地方是清的）
    '  vec4 o = texture2D(uPart, uv);',
    '  o = vec4(vec3(0.03, 0.05, 0.08) * uDark, uDark) + o * (1.0 - uDark);',
    '  float fa = uFog * (1.0 - cl * 0.92);',
    '  vec3 bl = texture2D(uBlur, uv).rgb; vec3 fc = mix(bl, vec3(dot(bl, vec3(0.3, 0.55, 0.15))) + 0.06, 0.22) * vec3(0.93, 0.97, 1.03);',
    '  o = vec4(fc * fa, fa) + o * (1.0 - fa);',
    // 水珠下方一点阴影
    '  float sh = clamp(texture2D(uWater, uv - vec2(0.0, 2.5 / uRes.y)).a * 5.0 - 2.4, 0.0, 1.0) * (1.0 - a) * 0.2;',
    '  o = vec4(0.0, 0.0, 0.0, sh) + o * (1.0 - sh);',
    // 水珠：小凸透镜，把后面的景倒过来缩小
    '  vec2 off = -n * (60.0 + h * 120.0) / uRes.y * vec2(uRes.y / uRes.x, 1.0);',
    '  vec3 lens = texture2D(uSharp, clamp(uv + off, 0.0, 1.0)).rgb;',
    '  lens = (lens * vec3(0.9, 0.95, 1.02) - 0.5) * 1.08 + 0.53;',
    '  float rim = 1.0 - smoothstep(0.0, 0.42, h);',
    '  lens *= 1.0 - rim * 0.38;',
    '  vec3 N = normalize(vec3(n.x, -n.y, h * 1.4 + 0.15));',
    '  float spec = pow(max(dot(N, normalize(vec3(-0.45, 0.55, 0.9))), 0.0), 60.0);',
    '  lens += spec * 0.85 + smoothstep(0.35, 0.9, n.y) * (1.0 - rim) * 0.35 * vec3(1.0, 0.98, 0.94);',
    '  o = vec4(clamp(lens, 0.0, 1.0) * a, a) + o * (1.0 - a);',
    '  gl_FragColor = o * uAlpha;',
    '}'].join('\n');
  function Rain(canvas) {
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('这台设备不支持 WebGL');
    this.gl = gl; this.canvas = canvas; this.W = 1; this.H = 1; this.k = 1; this.seed = 7; this.drops = []; this.crowns = []; this.streaks = []; this.n = 0; this.alpha = 0; this.on = false; this.last = 0;
    this.P = { fog: .24, dark: .06, rainChance: .22, rainLimit: 2, dropletsRate: 26, minR: 4, maxR: 13, splash: .5, streaks: 70, wind: 40 };
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, RAIN_FS)); gl.linkProgram(p); gl.useProgram(p); this.prog = p;
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var l = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
    var self = this; this.U = {}; ['uSharp', 'uBlur', 'uWater', 'uClr', 'uPart', 'uRes', 'uFog', 'uDark', 'uAlpha'].forEach(function (k) { self.U[k] = gl.getUniformLocation(p, k); });
    this.tx = [0, 1, 2, 3, 4].map(function (i) {
      var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      return t;
    });
    ['uSharp', 'uBlur', 'uWater', 'uClr', 'uPart'].forEach(function (k, i) { gl.uniform1i(self.U[k], i); });
    // 水珠贴图
    var N = 96, dc = rainCanvas(N, N), dx = dc.getContext('2d'), im = dx.createImageData(N, N), d = im.data;
    for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
      var u = (i + .5) / N * 2 - 1, v = (j + .5) / N * 2 - 1, vv = v < 0 ? v * 1.08 : v * .96, rr = Math.sqrt(u * u + vv * vv), q = (j * N + i) * 4;
      if (rr > 1) continue;
      d[q] = 128 + u * 127; d[q + 1] = 128 + vv * 127; d[q + 2] = Math.sqrt(Math.max(0, 1 - rr * rr)) * 255; d[q + 3] = 255 * Math.min(1, (1 - rr) * N / 3.2);
    }
    dx.putImageData(im, 0, 0); this.DROP = dc;
    var cc = rainCanvas(32, 32), cx = cc.getContext('2d'), g = cx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.6, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = g; cx.fillRect(0, 0, 32, 32); this.CLR = cc;
  }
  Rain.prototype.rnd = function () { var s = this.seed = this.seed + 0x6D2B79F5 | 0, t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  Rain.prototype.R = function (a, b) { return a + (b - a) * this.rnd(); };
  // cw/ch：画布像素；k：每个 CSS 像素几个画布像素（模拟按 CSS 像素算，和手机大小无关）
  Rain.prototype.size = function (cw, ch, k) {
    if (this.canvas.width === cw && this.canvas.height === ch && this.k === k && this.water) return;
    this.canvas.width = cw; this.canvas.height = ch; this.k = k; this.W = cw / k; this.H = ch / k;
    var W = Math.round(this.W), H = Math.round(this.H);
    this.water = rainCanvas(W, H); this.wx = this.water.getContext('2d');
    this.dropl = rainCanvas(W, H); this.dx = this.dropl.getContext('2d');
    this.clr = rainCanvas(W / 4, H / 4); this.cx = this.clr.getContext('2d');
    this.part = rainCanvas(W, H); this.px = this.part.getContext('2d');
    this.sharp = rainCanvas(cw / 3, ch / 3); this.sx = this.sharp.getContext('2d');
    this.blur = rainCanvas(cw / 8, ch / 8); this.bx = this.blur.getContext('2d');
    this.reset();
  };
  Rain.prototype.reset = function () {
    this.drops = []; this.crowns = []; this.streaks = []; this.seed = 7;
    if (this.dx) { this.dx.clearRect(0, 0, this.dropl.width, this.dropl.height); this.cx.clearRect(0, 0, this.clr.width, this.clr.height); }
    for (var i = 0; i < this.P.streaks; i++) this.streaks.push(this.streak(true));
    for (var t = 0; t < 5; t += 1 / 30) this.step(1 / 30);    // 预热：一打开玻璃上就已经积了一层水
    this.n = 0;
  };
  Rain.prototype.drop = function (o) { var d = { x: 0, y: 0, r: 0, spreadX: 0, spreadY: 0, momentum: 0, momentumX: 0, lastSpawn: 0, nextSpawn: 0, parent: null, isNew: true, killed: false, shrink: 0 }; for (var k in o) d[k] = o[k]; return d; };
  Rain.prototype.streak = function (init) {
    var z = Math.pow(this.rnd(), 1.6), W = this.W, H = this.H;
    return { x: this.R(-.1 * W, 1.1 * W), y: init ? this.R(-H, H) : this.R(-H * .4, -20), z: z, len: 14 + z * z * 150 + this.R(0, 20), v: 900 + z * 1500, w: .6 + z * z * 2.6, a: .12 + (1 - Math.abs(z - .45)) * .2 };
  };
  Rain.prototype.droplet = function (x, y, r) { this.dx.drawImage(this.DROP, x - r, y - r, r * 2, r * 2); };
  Rain.prototype.splash = function (x, y, big) {
    var P = this.P, r = this.R(P.minR * .9, P.maxR * (big ? .85 : .55)), n = Math.round(this.R(6, 14) * (big ? 1.4 : 1));
    this.drops.push(this.drop({ x: x, y: y, r: r, spreadX: 1.2, spreadY: .6 }));
    for (var i = 0; i < n; i++) {
      var a = this.R(0, Math.PI * 2), d = r * this.R(1.2, 3.6), rr = Math.max(.8, r * this.R(.08, .32) * (1 - d / (r * 5))), X = x + Math.cos(a) * d, Y = y + Math.sin(a) * d * .85;
      if (rr > P.minR * .55) this.drops.push(this.drop({ x: X, y: Y, r: rr })); else this.droplet(X, Y, rr);
    }
    this.crowns.push({ x: x, y: y, r: r, t: 0 });
  };
  Rain.prototype.step = function (dt) {
    var P = this.P, W = this.W, H = this.H, f = dt * 60, area = (W * H) / (412 * 915), self = this, i;
    // 细水雾
    var k = P.dropletsRate * f * area;
    for (i = 0; i < k; i++) this.droplet(this.R(0, W), this.R(0, H), Math.max(.6, Math.pow(this.rnd(), 2.2) * 2.6));
    // 新落下的水珠
    var limit = P.rainLimit * f * area, count = 0;
    while (this.rnd() < P.rainChance * f * area && count < limit) {
      count++; var r0 = P.minR + (P.maxR - P.minR) * Math.pow(this.rnd(), 3);
      this.drops.push(this.drop({ x: this.R(0, W), y: this.R(-.1 * H, .95 * H), r: r0, momentum: 1 + (r0 - P.minR) * .1 + this.R(0, 2), spreadX: 1.5, spreadY: 1.5 }));
    }
    if (this.rnd() < P.splash * dt) this.splash(this.R(0, W), this.R(.04 * H, .9 * H), this.rnd() < .35);
    var drops = this.drops; drops.sort(function (a, b) { return (a.y * W + a.x) - (b.y * W + b.x); });
    var minR = P.minR, maxR = P.maxR, deltaR = maxR - minR, out = [];
    for (i = 0; i < drops.length; i++) {
      var d = drops[i]; if (d.killed) continue;
      if (this.rnd() < (d.r - minR * 1.1) * (.1 / deltaR) * f) d.momentum += this.R(0, (d.r / maxR) * 4);
      if (d.r <= minR && this.rnd() < .05 * f) d.shrink += .01;
      d.r -= d.shrink * f; if (d.r <= 0) { d.killed = true; continue; }
      d.lastSpawn += d.momentum * f;
      if (d.lastSpawn > d.nextSpawn) {    // 往下流时身后留一串小水珠
        out.push(this.drop({ x: d.x + this.R(-d.r, d.r) * .1, y: d.y - d.r * .01, r: d.r * this.R(.2, .42), spreadY: Math.min(.5, d.momentum * .04), parent: d }));
        d.r *= Math.pow(.97, f); d.lastSpawn = 0; d.nextSpawn = this.R(minR, maxR) - d.momentum * 2 + (maxR - d.r);
      }
      d.spreadX *= Math.pow(.4, f); d.spreadY *= Math.pow(.7, f);
      var moved = d.momentum > 0;
      if (moved) {
        d.y += d.momentum * .5 * f;
        if (this.rnd() < .04 * f) d.momentumX += this.R(-1, 1) * Math.min(1.6, d.momentum * .35);    // 蜿蜒
        d.x += d.momentumX * .5 * f;
        if (d.y > H + d.r) d.killed = true;
      }
      if ((moved || d.isNew) && !d.killed) {
        for (var j = i + 1; j < Math.min(drops.length, i + 70); j++) {
          var e = drops[j];
          if (d.r > e.r && d.parent !== e && e.parent !== d && !e.killed) {
            var ddx = e.x - d.x, ddy = e.y - d.y;
            if (Math.sqrt(ddx * ddx + ddy * ddy) < (d.r + e.r) * (.65 + d.momentum * .01 * f)) {
              var tr = Math.min(maxR, Math.sqrt(d.r * d.r + e.r * e.r * .8));
              d.r = tr; d.momentumX += ddx * .1; d.spreadX = 0; d.spreadY = 0; e.killed = true;
              d.momentum = Math.max(e.momentum, Math.min(40, d.momentum + tr * .05 + 1));
            }
          }
        }
      }
      d.isNew = false;
      d.momentum -= Math.max(1, minR * .5 - d.momentum) * .1 * f; if (d.momentum < 0) d.momentum = 0;
      d.momentumX *= Math.pow(.7, f);
      if (!d.killed) {
        out.push(d);
        if (moved) {   // 流过的地方：擦掉细水雾，玻璃上的雾也擦清
          var cr = d.r * .69; this.dx.globalCompositeOperation = 'destination-out'; this.dx.beginPath(); this.dx.arc(d.x, d.y, cr, 0, Math.PI * 2); this.dx.fill(); this.dx.globalCompositeOperation = 'source-over';
          this.cx.drawImage(this.CLR, (d.x - cr * 1.6) / 4, (d.y - cr * 1.6) / 4, cr * 3.2 / 4, cr * 3.2 / 4);
        }
      }
    }
    this.drops = out.length > 900 ? out.slice(out.length - 900) : out;
    this.cx.globalCompositeOperation = 'destination-out'; this.cx.fillStyle = 'rgba(0,0,0,' + Math.min(1, .0045 * f) + ')'; this.cx.fillRect(0, 0, this.clr.width, this.clr.height); this.cx.globalCompositeOperation = 'source-over';
    // 窗外的雨丝
    var wv = P.wind;
    for (i = 0; i < this.streaks.length; i++) { var s = this.streaks[i]; s.y += s.v * dt; s.x += wv * (.4 + s.z) * dt * .9; if (s.y - s.len > H) this.streaks[i] = this.streak(false); }
    this.crowns.forEach(function (c) { c.t += dt; }); this.crowns = this.crowns.filter(function (c) { return c.t < .22; });
  };
  Rain.prototype.render = function (paint) {
    var gl = this.gl, P = this.P, i, x = this.wx;
    x.clearRect(0, 0, this.water.width, this.water.height); x.drawImage(this.dropl, 0, 0);
    for (i = 0; i < this.drops.length; i++) { var d = this.drops[i], w = d.r * 2 * (d.spreadX + 1), h = d.r * 3 * (d.spreadY + 1); x.drawImage(this.DROP, d.x - w / 2, d.y - h / 2, w, h); }
    var p = this.px; p.clearRect(0, 0, this.part.width, this.part.height); p.lineCap = 'round';
    for (i = 0; i < this.streaks.length; i++) {
      var s = this.streaks[i], ang = Math.atan2(s.v, P.wind * (.4 + s.z) * .9), ex = s.x - Math.cos(ang) * s.len, ey = s.y - Math.sin(ang) * s.len;
      var g = p.createLinearGradient(ex, ey, s.x, s.y); g.addColorStop(0, 'rgba(225,235,245,0)'); g.addColorStop(1, 'rgba(232,240,248,' + s.a + ')');
      p.strokeStyle = g; p.lineWidth = s.w; p.beginPath(); p.moveTo(ex, ey); p.lineTo(s.x, s.y); p.stroke();
    }
    for (i = 0; i < this.crowns.length; i++) {   // 雨点砸到玻璃的一瞬：一圈细水花
      var c = this.crowns[i], q = c.t / .22, rr = c.r * (1 + q * 2.6); p.strokeStyle = 'rgba(240,246,252,' + (.5 * (1 - q)) + ')'; p.lineWidth = 1;
      for (var m = 0; m < 12; m++) { var a = m / 12 * 6.283 + c.x; p.beginPath(); p.moveTo(c.x + Math.cos(a) * rr * .55, c.y + Math.sin(a) * rr * .55); p.lineTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr); p.stroke(); }
    }
    // 壁纸：清楚的小图（透镜里用）每帧取；虚的（起雾用）隔帧取
    try { this.sx.clearRect(0, 0, this.sharp.width, this.sharp.height); paint(this.sx, this.sharp.width, this.sharp.height); } catch (e) {}
    if (this.n++ % 2 === 0) { try { var bx = this.bx, bw = this.blur.width, bh = this.blur.height; bx.filter = 'none'; bx.clearRect(0, 0, bw, bh); bx.filter = 'blur(' + Math.max(1, bw / 40).toFixed(1) + 'px)'; bx.drawImage(this.sharp, -bw * .02, -bh * .02, bw * 1.04, bh * 1.04); bx.filter = 'none'; } catch (e) {} }
    var up = function (unit, src, pre) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.tx[unit]); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!pre); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); }.bind(this);
    up(0, this.sharp, false); if (this.n % 2 === 1) up(1, this.blur, false); up(2, this.water, false); up(3, this.clr, false); up(4, this.part, true);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.useProgram(this.prog);
    gl.uniform2f(this.U.uRes, this.canvas.width, this.canvas.height); gl.uniform1f(this.U.uFog, P.fog); gl.uniform1f(this.U.uDark, P.dark); gl.uniform1f(this.U.uAlpha, this.alpha);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  // 一帧：on 变化时 0.8 秒淡入淡出；完全淡出后清空画布、不再画
  Rain.prototype.frame = function (paint, now) {
    now = now == null ? Date.now() : now;
    var dt = this.last ? Math.min(.1, Math.max(0, (now - this.last) / 1000)) : 1 / 30; this.last = now;
    var tgt = this.on ? 1 : 0; if (this.alpha !== tgt) this.alpha = tgt > this.alpha ? Math.min(1, this.alpha + dt / .8) : Math.max(0, this.alpha - dt / .8);
    if (!this.alpha) { if (!this.cleared) { var gl = this.gl; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); this.cleared = true; } return false; }
    this.cleared = false; this.step(dt); this.render(paint); return true;
  };
  Rain.prototype.busy = function () { return this.on || this.alpha > 0; };

  return { Rain: Rain, translate: translate, scan: scan, unpack: unpack, readTex: readTex, lz4: lz4, Scene: Scene, Renderer: Renderer, splitIndex: splitIndex, split: split, userProps: userProps, propDefaults: propDefaults, bind: bind };
}
window.WallScene = __wallFactory();

/* ---------- 5.12 后台线程渲染：两块画布 transferControlToOffscreen 交给 Worker，主线程每帧只发一条参数消息 ----------
 * 主线程 → 后台：load{tok, buf, back, front, w, h, opt} / size{w,h} / set{focus, zoom, flip, ca, align, props} /
 *               draw{time, pan, rip, sf, audio} / snap{id, w, h} / grab{id, w, h, time} / scan{id, cands, y0, H, fy} / drop
 * 后台 → 主线程：ready{tok, warn, kinds, audio, S} / err{tok, msg} / snap{id, bmp} / grab{id, px} / scan{id, list} */
function __wallWorkerMain() {
  var R = [], cvs = null, tok = 0, A = null, last = { time: 0, pan: 0, rip: null, sf: null }, curTok = 0, GL = null, RN = null, rbmp = null;
  function audio() { return A; }
  function draw(time) {
    if (!R.length) return;
    R.forEach(function (r) { r.pan = last.pan || 0; r.rip = last.rip; r.sf = last.sf; r.draw(time == null ? last.time : time); });
    glass(); rain();
  }
  // 5.13 写实小雨：画在壁纸上面那块透明画布上；壁纸取自两块壁纸画布（或主线程交来的视频 / 图片小图）
  function paintScene(x, W, H) { if (R.length && cvs) { x.drawImage(cvs[0], 0, 0, W, H); x.drawImage(cvs[1], 0, 0, W, H); } else if (rbmp) x.drawImage(rbmp, 0, 0, W, H); }
  function rain() { if (RN && RN.busy()) { try { RN.frame(paintScene); } catch (e) { postMessage({ t: 'err', msg: 'rain: ' + (e && e.message || e) }); RN.on = false; RN.alpha = 0; } } }
  // 5.12 玻璃共用的模糊图：每画完一帧，把整屏壁纸缩小、模糊画进一块小画布（主线程按玻璃的位置只露出这块）
  function glass() {
    if (!GL || !GL.on || !cvs) return;
    var c = GL.c, x = GL.x, W = c.width, H = c.height, m = .012;
    x.filter = 'none'; x.clearRect(0, 0, W, H); x.filter = GL.f;
    x.drawImage(cvs[0], -W * m, -H * m, W * (1 + 2 * m), H * (1 + 2 * m)); x.drawImage(cvs[1], -W * m, -H * m, W * (1 + 2 * m), H * (1 + 2 * m));
  }
  function drop() { R.forEach(function (r) { try { r.destroy(); } catch (e) {} }); R = []; }
  var assetSeq = 0, assets = {};
  self.__wallReadAsset = function (url) {
    return new Promise(function (ok, no) { var id = ++assetSeq; assets[id] = { ok: ok, no: no }; postMessage({ t: 'asset', assetId: id, url: url }); });
  };
  onmessage = function (e) {
    var d = e.data;
    if (d.t === 'asset') { var a = assets[d.assetId]; if (!a) return; delete assets[d.assetId]; if (d.err) a.no(new Error(d.err)); else a.ok(new Uint8Array(d.buf)); return; }
    try {
      if (d.t === 'load') {
        drop(); curTok = d.tok; cvs = [d.back, d.front]; cvs.forEach(function (c) { c.width = d.w; c.height = d.h; });
        var pkg = d.buf.files ? d.buf : WallScene.unpack(d.buf), sc = new WallScene.Scene(pkg), L = sc.layers(), parts = WallScene.split(L, sc.size());
        var opt = d.opt || {}; opt.audio = audio;
        var RR = [new WallScene.Renderer(cvs[0], sc, parts[0], Object.assign({ clear: true }, opt)), new WallScene.Renderer(cvs[1], sc, parts[1], opt)];
        R = RR;
        Promise.all(RR.map(function (r) { return r.load(); })).then(function () {
          if (curTok !== d.tok) return;
          draw();
          postMessage({ t: 'ready', tok: d.tok, warn: RR[0].warn.concat(RR[1].warn), audio: RR.some(function (r) { return r.usesAudio(); }), S: sc.size(), motion: L.some(function (l) { return l.kind === 'particle' || l.effects.length > 0; }),
            kinds: RR.map(function (r) { return r.layers.map(function (L) { return L.kind + (L.fx ? ':' + L.fx.length : ''); }); }),
            fg: RR[1].layers.some(function (L) { return L.kind === 'image'; }) });
        }, function (err) { postMessage({ t: 'err', tok: d.tok, msg: String(err && err.message || err) }); });
      } else if (d.t === 'glass') {   // {canvas?（第一次交过来）, on, w, h, f（CSS filter 串）}
        if (d.canvas) GL = { c: d.canvas, x: d.canvas.getContext('2d'), on: false, f: 'none' };
        if (GL) { GL.on = !!d.on; if (d.w && (GL.c.width !== d.w || GL.c.height !== d.h)) { GL.c.width = d.w; GL.c.height = d.h; } if (d.f) GL.f = d.f; if (GL.on) glass(); }
      } else if (d.t === 'rain') {   // {canvas?（第一次交过来）, on, w, h, k}
        if (d.canvas) { try { RN = new WallScene.Rain(d.canvas); } catch (e) { RN = null; postMessage({ t: 'err', msg: 'rain: ' + (e && e.message || e) }); } }
        if (RN) { if (d.w) RN.size(d.w, d.h, d.k || 1); RN.on = !!d.on; if (d.cut) { RN.alpha = 0; RN.frame(paintScene); } }
      } else if (d.t === 'rainf') {
        if (d.tok !== curTok && R.length) { if (d.bmp && d.bmp.close) d.bmp.close(); postMessage({ t: 'f', frameId: d.frameId }); return; }   // 没有场景壁纸（视频 / 图片）时单独画一帧雨；bmp = 当前画面的小图
        if (d.bmp) { if (rbmp && rbmp.close) rbmp.close(); rbmp = d.bmp; }
        if (!R.length) rain(); postMessage({ t: 'f', frameId: d.frameId });
      } else if (d.t === 'size') { if (cvs) cvs.forEach(function (c) { c.width = d.w; c.height = d.h; }); draw(); }
      else if (d.t === 'set') {
        R.forEach(function (r) { if (d.focus) r.focus = d.focus; if (d.zoom != null) r.zoom = d.zoom; if ('flip' in d) r.flip = d.flip; if ('ca' in d) r.ca = d.ca; if (d.align) r.align = d.align; if (d.props) r.setProps(d.props); });
        if (d.redraw) draw();
      } else if (d.t === 'draw') { if (d.tok !== curTok) { postMessage({ t: 'f', frameId: d.frameId }); return; } last = d; if (d.audio) A = d.audio; draw(); postMessage({ t: 'f', frameId: d.frameId }); }   // 画完回一声，主线程才发下一帧（不排队）
      else if (d.t === 'snap' || d.t === 'grab') {
        var W = d.w || (cvs ? cvs[0].width : 1), H = d.h || (cvs ? cvs[0].height : 1), oc = new OffscreenCanvas(W, H), x = oc.getContext('2d');
        if (R.length && cvs) { if (d.time != null) R.forEach(function (r) { r.lastT = null; }); draw(d.time); x.drawImage(cvs[0], 0, 0, W, H); x.drawImage(cvs[1], 0, 0, W, H); }
        if (d.t === 'snap') { var bmp = oc.transferToImageBitmap(); postMessage({ t: 'snap', id: d.id, bmp: bmp }, [bmp]); }
        else { var px = x.getImageData(0, 0, W, H).data; postMessage({ t: 'grab', id: d.id, px: px }, [px.buffer]); }
      } else if (d.t === 'scan') {   // 自动构图：前景那块画布在几个左右位置的样子
        var r1 = R[1], list = []; if (!r1 || !r1.ready) { postMessage({ t: 'scan', id: d.id, list: [] }); return; }
        var gl = r1.gl, c = r1.canvas, full = new Uint8Array(c.width * c.height * 4), keep = r1.focus;
        d.cands.forEach(function (fx) {
          r1.focus = [fx, d.fy]; r1.draw(last.time);
          gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, full);
          var vis = 0; for (var q = 3; q < full.length; q += 4 * 9) if (full[q] > 60) vis++;
          list.push({ fx: fx, vis: vis, band: full.slice(d.y0 * c.width * 4, (d.y0 + d.H) * c.width * 4) });
        });
        r1.focus = keep; draw();
        postMessage({ t: 'scan', id: d.id, list: list, cw: c.width }, list.map(function (o) { return o.band.buffer; }));
      } else if (d.t === 'drop') { drop(); curTok = -1; }
    } catch (err) { postMessage({ t: 'err', tok: d.tok || curTok, msg: String(err && err.message || err) }); }
  };
}
// 能不能用后台线程画：要有 OffscreenCanvas 的 WebGL 和 transferControlToOffscreen
WallScene.workerOk = function () {
  try { return typeof OffscreenCanvas !== 'undefined' && !!HTMLCanvasElement.prototype.transferControlToOffscreen && !!new OffscreenCanvas(4, 4).getContext('webgl') && typeof Worker !== 'undefined'; }
  catch (e) { return false; }
};
WallScene.makeWorker = function () {
  var src = 'self.window = self;\nvar WallRuntime = (' + __wallRuntimeFactory.toString() + ')();\nvar WallScene = (' + __wallFactory.toString() + ')();\n(' + __wallWorkerMain.toString() + ')();';
  return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
};
