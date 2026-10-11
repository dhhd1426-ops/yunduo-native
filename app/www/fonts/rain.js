/* 云朵天气 · 写实小雨（5.13 起；5.19 从壁纸引擎 wall.js 里单独拿出来，壁纸引擎已删除）
 * 用法：var RN = new RainFx(canvas); RN.size(w, h, dpr); RN.on = true; 每帧 RN.frame(function (ctx, W, H) { 把壁纸画进去 });
 */
var RainFx = (function () {
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

  return Rain;
})();
