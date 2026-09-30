/* 云朵天气 5.0 · 天气场景动效引擎
 * 两块画布：back（字后面：天空、云、远处的雨、闪电、星星）/ front（字前面：溅开的水花、挂珠、积雪、近处的雨、雾、叶子）。
 * 字由页面自己画；这里拿到一张“字形遮罩”（和画布一样大的 canvas，字的地方不透明），用它做碰撞：
 * 雨滴打在字的上沿碎开、字的下沿挂水珠、雪积在字顶上、光从字上扫过。
 * scene：sun / cloudy / rain / storm / snow / fog / night / wind
 * opt.light：首页用的轻量版——不画天空和云，只保留落在字上的那一层（壁纸本身就是画面）
 */
window.WxFX = (function () {
  'use strict';
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function create(o) {
    var SCN = o.scene, W = o.w, H = o.h, DPR = o.dpr || 2, light = !!o.light, R = rng(o.seed || 7), rnd = function (a, b) { return a + R() * (b - a); };
    var bg = o.back ? o.back.getContext('2d') : null, fg = o.front.getContext('2d');
    [o.back, o.front].forEach(function (c) { if (!c) return; c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); });
    if (bg) bg.setTransform(DPR, 0, 0, DPR, 0, 0); fg.setTransform(DPR, 0, 0, DPR, 0, 0);

    /* ---------- 碰撞表 ---------- */
    var MASKC = o.mask, LEDGE = [], BOTTOM = [], textBottom = o.textBottom || H;
    (function () {
      var d = MASKC.getContext('2d').getImageData(0, 0, W, H).data, M = new Uint8Array(W * H);
      for (var i = 0; i < W * H; i++) M[i] = d[i * 4 + 3] > 110 ? 1 : 0;
      for (var x = 0; x < W; x++) { LEDGE[x] = []; for (var y = 1; y < H - 1; y++) {
        if (M[y * W + x] && !M[(y - 1) * W + x]) LEDGE[x].push(y);
        if (M[y * W + x] && !M[(y + 1) * W + x] && y < textBottom) BOTTOM.push([x, y + 1]);
      } }
    })();
    function hit(x, y0, y1) { var L = LEDGE[Math.round(x)]; if (!L) return -1; for (var i = 0; i < L.length; i++) if (L[i] > y0 && L[i] <= y1) return L[i]; return -1; }

    var t = 0, drops = [], splash = [], beads = [], flakes = [], snowH = {}, clouds = [], leaves = [], stars = [], bolt = null, flash = 0, glint = -1, meteor = null;
    var WIND = ({ rain: -60, storm: -170, snow: -14, wind: -520 }[SCN] || 0) * (o.windMul || 1);
    var tmpC = document.createElement('canvas'); tmpC.width = Math.ceil(W); tmpC.height = Math.ceil(H); var tmp = tmpC.getContext('2d');

    function blob(w, h, n, blur, seed) {
      var r2 = rng(seed), c = document.createElement('canvas'); c.width = w + blur * 4; c.height = h + blur * 4; var x = c.getContext('2d');
      x.filter = 'blur(' + blur + 'px)'; x.fillStyle = '#fff';
      for (var i = 0; i < n; i++) { var cx = blur * 2 + w * (.15 + r2() * .7), cy = blur * 2 + h * (.35 + r2() * .4), rr = h * (.22 + r2() * .28); x.beginPath(); x.arc(cx, cy, rr, 0, 7); x.fill(); }
      x.beginPath(); x.ellipse(blur * 2 + w / 2, blur * 2 + h * .68, w * .44, h * .2, 0, 0, 7); x.fill();
      return c;
    }
    function fogTex(seed) {
      var r2 = rng(seed), c = document.createElement('canvas'); c.width = 900; c.height = Math.ceil(H); var x = c.getContext('2d'); x.filter = 'blur(26px)';
      for (var i = 0; i < 46; i++) { var cx = r2() * 900, cy = 40 + r2() * (H - 60), rr = 50 + r2() * 110;
        x.fillStyle = 'rgba(225,230,232,' + (.10 + r2() * .22) + ')';
        [0, 900, -900].forEach(function (off) { if (off && !(off > 0 ? cx < 200 : cx > 700)) return; x.beginPath(); x.ellipse(cx + off, cy, rr * 1.8, rr * .7, 0, 0, 7); x.fill(); }); }
      return c;
    }
    var density = o.density || 1;
    function newDrop(any) {
      var front = light ? true : R() < .55, v = front ? rnd(760, 1050) : rnd(430, 620);
      if (SCN === 'storm') v *= 1.2;
      return { x: rnd(-40, W + 120), y: any ? rnd(-40, H) : rnd(-80, -10), v: v, front: front, len: v * (front ? .022 : .016), a: (front ? rnd(.28, .5) : rnd(.12, .26)) * (light ? .55 : 1) };
    }
    function newFlake(any) { var z = R(); return { x: rnd(-20, W + 20), y: any ? rnd(-10, H) : rnd(-20, -4), r: .6 + z * 2.4, v: 18 + z * 55, ph: rnd(0, 7), sw: rnd(8, 22), z: z }; }
    function newLeaf(any) { return { x: any ? rnd(-20, W + 60) : W + rnd(10, 80), y: rnd(20, H - 20), v: rnd(260, 520), rot: rnd(0, 7), vr: rnd(-8, 8), s: rnd(3, 6.5), bob: rnd(0, 7), c: ['#c9a36a', '#b8864f', '#d9c08a', '#8f9b6a'][Math.floor(rnd(0, 4))] }; }
    function settle(x, amt) {
      var xi = Math.round(x), L = LEDGE[xi]; if (!L || !L.length) return false;
      var y = L[0];
      for (var dx = -3; dx <= 3; dx++) { var xx = xi + dx, LL = LEDGE[xx]; if (!LL) continue;
        for (var j = 0; j < LL.length; j++) if (Math.abs(LL[j] - y) < 3) { var k = xx + ',' + LL[j]; snowH[k] = Math.min(4.4, (snowH[k] || 0) + amt * .11 * (1 - Math.abs(dx) / 4)); } }
      return true;
    }
    function burst(x, y, n, spd) {
      for (var i = 0; i < n; i++) { var ang = -Math.PI / 2 + rnd(-1.25, 1.25), s = rnd(.35, 1) * spd;
        splash.push({ x: x, y: y - 1, vx: Math.cos(ang) * s + WIND * .15, vy: Math.sin(ang) * s, life: rnd(.25, .5), age: 0, r: rnd(.7, 1.7) }); }
      splash.push({ ring: 1, x: x, y: y, age: 0, life: .2 });
    }
    function beadAdd(x, y, grow) { beads.push({ x: x, y: y, r: .6, max: rnd(1.8, 2.8), g: grow ? rnd(.5, 1) : 2, vy: 0 }); }
    function strike() {
      var x = rnd(W * .55, W * .95), pts = [[x, -10]], y = -10;
      while (y < H * .55) { y += rnd(14, 30); x += rnd(-22, 18); pts.push([x, y]); }
      var br = []; for (var i = 3; i < pts.length - 2; i += 3) if (R() < .6) { var bx = pts[i][0], by = pts[i][1], b = [[bx, by]]; for (var j = 0; j < 4; j++) { bx += rnd(-26, 8); by += rnd(10, 24); b.push([bx, by]); } br.push(b); }
      bolt = { pts: pts, br: br, age: 0 }; flash = 1;
    }

    /* ---------- 初始化 ---------- */
    if (SCN === 'rain' || SCN === 'storm') { var n = Math.round((SCN === 'storm' ? 230 : 150) * density * (light ? .45 : 1) * W / 412); for (var i = 0; i < n; i++) drops.push(newDrop(true)); }
    if (!light && /^(sun|cloudy|wind|storm|rain)$/.test(SCN)) {
      var nc = { sun: 4, cloudy: 6, wind: 5, storm: 4, rain: 4 }[SCN];
      for (var k = 0; k < nc; k++) {
        var w = rnd(170, 290), h = w * rnd(.36, .5); if (SCN === 'sun') { w *= 1.25; h *= 1.2; }
        clouds.push({ img: blob(w, h, 9, SCN === 'sun' ? 16 : 20, 11 + k * 7), x: SCN === 'sun' ? [-.1, .41, .73, .1][k] * W : rnd(-120, W), y: SCN === 'sun' ? [70, 10, 150, 190][k] * H / 480 : rnd(-10, H * .5),
          s: rnd(.55, 1.1), v: (SCN === 'wind' ? rnd(40, 70) : rnd(4, 11)) * (k % 2 ? 1 : .7), hue: rnd(0, 1), a: SCN === 'sun' ? rnd(.7, .85) : rnd(.35, .6), z: k % 3 });
      }
    }
    if (SCN === 'fog') for (var f = 0; f < (light ? 1 : 3); f++) clouds.push({ fog: 1, img: fogTex(40 + f), x: 0, y: 0, v: [5, 9, 14][f], a: ([.34, .28, .22][f]) * (light ? .5 : 1) });
    if (SCN === 'snow') { var nf = Math.round(170 * density * (light ? .5 : 1) * W / 412); for (var s = 0; s < nf; s++) flakes.push(newFlake(true)); for (var p = 0; p < 2600 * W / 412; p++) settle(rnd(0, W), 1); }
    if (SCN === 'night' && !light) for (var st = 0; st < 110; st++) stars.push({ x: rnd(0, W), y: rnd(0, H * .62), r: rnd(.3, 1.3), ph: rnd(0, 7), f: rnd(.6, 2.2) });
    if (SCN === 'wind' && !light) for (var l = 0; l < 22; l++) leaves.push(newLeaf(true));

    /* ---------- 一步 ---------- */
    function step(dt) {
      t += dt;
      drops.forEach(function (d, i) {
        var y0 = d.y; d.y += d.v * dt; d.x += WIND * dt * (d.front ? 1 : .7);
        if (d.front) { var hy = hit(d.x, y0, d.y); if (hy >= 0 && R() < .92) { burst(d.x, hy, SCN === 'storm' ? 10 : 8, SCN === 'storm' ? 170 : 140); if (R() < .05) beadAdd(d.x, hy); drops[i] = newDrop(); return; } }
        if (d.y > H + 20) drops[i] = newDrop();
      });
      splash = splash.filter(function (p) { p.age += dt; if (!p.ring) { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; } return p.age < p.life; });
      if ((SCN === 'rain' || SCN === 'storm') && BOTTOM.length && beads.length < 7 && R() < dt * 1.4) { var b = BOTTOM[Math.floor(R() * BOTTOM.length)]; beadAdd(b[0], b[1], 1); }
      beads = beads.filter(function (b) {
        if (!b.fall) { b.r = Math.min(b.max, b.r + dt * b.g); if (b.r >= b.max) b.fall = 1; return true; }
        b.vy += 1300 * dt; var y0 = b.y; b.y += b.vy * dt;
        var hy = hit(b.x, y0 + b.r, b.y + b.r); if (hy >= 0 && hy > y0 + 3) { burst(b.x, hy, 6, 110); return false; }
        return b.y < H + 10;
      });
      flakes.forEach(function (f, i) {
        var y0 = f.y; f.y += f.v * dt; f.x += (Math.sin(t * .9 + f.ph) * f.sw * .06 + WIND * .5 * (.5 + f.z)) * dt * 3;
        if (f.z > .45) { var hy = hit(f.x, y0, f.y); if (hy >= 0 && R() < .8) { settle(f.x, 1.4 + f.z); flakes[i] = newFlake(); return; } }
        if (f.y > H + 6 || f.x < -30) flakes[i] = newFlake();
      });
      if (SCN === 'snow') for (var k in snowH) { snowH[k] -= dt * .004; if (snowH[k] <= 0) delete snowH[k]; }
      clouds.forEach(function (c) { c.x += c.v * dt; var w = c.fog ? 900 : c.img.width * c.s; if (!c.fog && c.x > W + 40) { c.x = -w - rnd(0, 80); c.y = rnd(-10, H * .5); } if (c.fog && c.x > 900) c.x -= 900; });
      leaves.forEach(function (l, i) { l.x -= l.v * dt * (0.8 + .4 * Math.sin(t * 1.3)); l.y += Math.sin(t * 3 + l.bob) * 40 * dt; l.rot += l.vr * dt; if (l.x < -30) leaves[i] = newLeaf(); });
      if (SCN === 'storm') { flash = Math.max(0, flash - dt * 2.6); if (t % 5.2 < dt) strike(); if (bolt) { bolt.age += dt; if (bolt.age > .55) bolt = null; } }
      if ((SCN === 'sun' || SCN === 'night') && !o.noGlint) { var gp = (t % 7.5) / 1.6; glint = gp <= 1 ? gp : -1; }
      if (SCN === 'night' && !light) { if (!meteor && t % 6 < dt) meteor = { x: rnd(W * .5, W), y: rnd(10, 80), age: 0 }; if (meteor) { meteor.age += dt; if (meteor.age > .9) meteor = null; } }
    }

    /* ---------- 画 ---------- */
    function drawCloud(c, cl) {
      var w = cl.img.width * cl.s, h = cl.img.height * cl.s;
      if (SCN === 'sun') {   // 彩虹色棉花糖：薄膜干涉的颜色在云里慢慢流动
        tmp.clearRect(0, 0, tmpC.width, tmpC.height); tmp.globalCompositeOperation = 'source-over'; tmp.drawImage(cl.img, 0, 0, w, h);
        tmp.globalCompositeOperation = 'source-atop';
        var ang = t * .07 + cl.hue * 6, gx = Math.cos(ang) * w * .6, gy = Math.sin(ang) * h * .6, g = tmp.createLinearGradient(w / 2 - gx, h / 2 - gy, w / 2 + gx, h / 2 + gy);
        var P = ['#ffb0d0', '#d6b2ff', '#a6d6ff', '#aef0d0', '#ffe8a0', '#ffbfa4', '#ffb0d0'], sh = (t * .03 + cl.hue) % 1;
        for (var i = 0; i < P.length; i++) g.addColorStop(((i / (P.length - 1)) + sh) % 1, P[i]);
        tmp.fillStyle = g; tmp.fillRect(0, 0, w, h);
        var hl = tmp.createRadialGradient(w * .4, h * .3, 0, w * .4, h * .3, w * .5); hl.addColorStop(0, 'rgba(255,255,255,.55)'); hl.addColorStop(1, 'rgba(255,255,255,0)'); tmp.fillStyle = hl; tmp.fillRect(0, 0, w, h);
        tmp.globalCompositeOperation = 'source-over';
        c.save(); c.globalAlpha = cl.a; c.drawImage(tmpC, 0, 0, Math.min(w, tmpC.width), Math.min(h, tmpC.height), cl.x, cl.y, Math.min(w, tmpC.width), Math.min(h, tmpC.height)); c.restore();
      } else { c.save(); c.globalAlpha = cl.a * (SCN === 'wind' ? .7 : SCN === 'cloudy' ? .8 : .6); c.drawImage(cl.img, cl.x, cl.y, w, h * (SCN === 'wind' ? .7 : 1)); c.restore(); }
    }
    function drawBack() {
      if (!bg) return; var c = bg; c.clearRect(0, 0, W, H);
      if (SCN === 'sun') {
        var gx = W * .9, gy = -18, g = c.createRadialGradient(gx, gy, 0, gx, gy, 300); g.addColorStop(0, 'rgba(255,244,220,.75)'); g.addColorStop(.25, 'rgba(255,214,170,.18)'); g.addColorStop(1, 'rgba(255,200,160,0)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        c.save(); c.translate(gx, gy); c.rotate(t * .02); c.globalCompositeOperation = 'lighter';
        for (var i = 0; i < 9; i++) { c.rotate(Math.PI * 2 / 9); var lg = c.createLinearGradient(0, 0, 0, 330); lg.addColorStop(0, 'rgba(255,238,210,.07)'); lg.addColorStop(1, 'rgba(255,238,210,0)'); c.fillStyle = lg; c.beginPath(); c.moveTo(-7, 0); c.lineTo(7, 0); c.lineTo(34, 330); c.lineTo(-34, 330); c.fill(); }
        c.restore();
      }
      if (SCN === 'night') {
        var mx = W * .83, my = 54, mg = c.createRadialGradient(mx, my, 0, mx, my, 170); mg.addColorStop(0, 'rgba(220,230,255,.30)'); mg.addColorStop(1, 'rgba(220,230,255,0)'); c.fillStyle = mg; c.fillRect(0, 0, W, H);
        tmp.clearRect(0, 0, 90, 90); tmp.globalCompositeOperation = 'source-over'; tmp.fillStyle = '#f3f1e6'; tmp.beginPath(); tmp.arc(40, 40, 17, 0, 7); tmp.fill(); tmp.globalCompositeOperation = 'destination-out'; tmp.beginPath(); tmp.arc(49, 33, 15, 0, 7); tmp.fill(); tmp.globalCompositeOperation = 'source-over';
        c.save(); c.shadowColor = 'rgba(230,236,255,.8)'; c.shadowBlur = 12; c.drawImage(tmpC, 0, 0, 80, 80, mx - 40, my - 40, 80, 80); c.restore();
        stars.forEach(function (s) { var a = .35 + .65 * Math.pow(.5 + .5 * Math.sin(t * s.f + s.ph), 3); c.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')'; c.beginPath(); c.arc(s.x, s.y, s.r, 0, 7); c.fill(); });
        if (meteor) { var p = meteor.age / .9, ex = meteor.x - p * 200, ey = meteor.y + p * 90, lgm = c.createLinearGradient(ex, ey, ex + 70, ey - 32); lgm.addColorStop(0, 'rgba(255,255,255,' + (1 - p) + ')'); lgm.addColorStop(1, 'rgba(255,255,255,0)'); c.strokeStyle = lgm; c.lineWidth = 1.4; c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex + 70, ey - 32); c.stroke(); }
      }
      if (SCN === 'storm' && bolt) {
        var a = bolt.age < .12 ? 1 : Math.max(0, 1 - (bolt.age - .12) / .4) * (bolt.age % .1 < .05 ? 1 : .6);
        c.save(); c.shadowColor = 'rgba(190,210,255,.9)'; c.shadowBlur = 16; c.strokeStyle = 'rgba(245,248,255,' + a + ')'; c.lineWidth = 2.2; c.lineJoin = 'round';
        c.beginPath(); bolt.pts.forEach(function (p, i) { i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }); c.stroke();
        c.lineWidth = 1; bolt.br.forEach(function (b) { c.beginPath(); b.forEach(function (p, i) { i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }); c.stroke(); }); c.restore();
      }
      clouds.forEach(function (cl) { if (!cl.fog && cl.z < 2) drawCloud(c, cl); });
      c.lineCap = 'round';
      drops.forEach(function (d) { if (d.front) return; c.strokeStyle = 'rgba(205,222,238,' + d.a + ')'; c.lineWidth = .7; c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(d.x - WIND * d.len / d.v, d.y - d.len); c.stroke(); });
      flakes.forEach(function (f) { if (f.z > .45) return; c.fillStyle = 'rgba(255,255,255,' + (.35 + f.z) + ')'; c.beginPath(); c.arc(f.x, f.y, f.r, 0, 7); c.fill(); });
    }
    function maskedFill(style) { tmp.clearRect(0, 0, tmpC.width, tmpC.height); tmp.globalCompositeOperation = 'source-over'; tmp.drawImage(MASKC, 0, 0); tmp.globalCompositeOperation = 'source-in'; tmp.fillStyle = style; tmp.fillRect(0, 0, W, H); tmp.globalCompositeOperation = 'source-over'; }
    function drawFront() {
      var c = fg; c.clearRect(0, 0, W, H);
      if (SCN === 'storm' && flash > .05) { maskedFill('rgba(235,242,255,' + (flash * .8) + ')'); c.save(); c.shadowColor = 'rgba(200,220,255,' + flash + ')'; c.shadowBlur = 22; c.drawImage(tmpC, 0, 0, W, H); c.restore(); }
      if (glint >= 0) {  // 一道光从字上扫过
        var gx = -60 + glint * (W * .92), g = fg.createLinearGradient(gx - 40, 0, gx + 40, 60);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, SCN === 'night' ? 'rgba(190,210,255,.9)' : 'rgba(255,226,170,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        maskedFill(g); c.drawImage(tmpC, 0, 0, W, H);
      }
      if (SCN === 'rain' || SCN === 'storm') { c.fillStyle = 'rgba(210,235,255,.55)'; for (var x = 0; x < W; x++) { var L = LEDGE[x]; if (!L) continue; for (var j = 0; j < L.length; j++) if (L[j] < textBottom) c.fillRect(x, L[j] - .5, 1, .9); } }
      if (SCN === 'snow') {
        c.fillStyle = '#ffffff'; c.shadowColor = 'rgba(160,190,220,.6)'; c.shadowBlur = 2;
        for (var k in snowH) { var h = snowH[k]; if (h < .25) continue; var p = k.split(','), sx = +p[0], sy = +p[1]; c.beginPath(); c.ellipse(sx, sy - h * .45, 1.1, h * .62 + .3, 0, 0, 7); c.fill(); }
        c.shadowBlur = 0;
      }
      clouds.forEach(function (cl) { if (cl.fog) { c.save(); c.globalAlpha = cl.a; c.drawImage(cl.img, cl.x - 900, 0); c.drawImage(cl.img, cl.x, 0); c.restore(); } else if (cl.z === 2) { c.save(); c.globalAlpha = .6; drawCloud(c, cl); c.restore(); } });
      c.lineCap = 'round';
      drops.forEach(function (d) { if (!d.front) return; c.strokeStyle = 'rgba(225,238,250,' + d.a + ')'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(d.x - WIND * d.len / d.v, d.y - d.len); c.stroke(); });
      splash.forEach(function (p) {
        var k = 1 - p.age / p.life;
        if (p.ring) { c.strokeStyle = 'rgba(220,238,255,' + (k * .7) + ')'; c.lineWidth = .8; c.beginPath(); c.ellipse(p.x, p.y, 2 + (1 - k) * 7, .8 + (1 - k) * 1.6, 0, Math.PI, 0); c.stroke(); }
        else { c.fillStyle = 'rgba(232,244,255,' + (k * .9) + ')'; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill(); }
      });
      beads.forEach(function (b) {
        var g = c.createRadialGradient(b.x - b.r * .3, b.y + b.r * .5, 0, b.x, b.y + b.r, b.r * 1.3); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.5, 'rgba(200,225,245,.55)'); g.addColorStop(1, 'rgba(160,190,215,.25)');
        c.fillStyle = g; c.beginPath(); c.ellipse(b.x, b.y + b.r * (b.fall ? 1 : 1.1), b.r * .85, b.r * (b.fall ? 1.3 : 1.1), 0, 0, 7); c.fill();
      });
      flakes.forEach(function (f) { if (f.z <= .45) return; c.fillStyle = 'rgba(255,255,255,' + (.55 + f.z * .45) + ')'; c.beginPath(); c.arc(f.x, f.y, f.r, 0, 7); c.fill(); });
      leaves.forEach(function (l) { c.save(); c.translate(l.x, l.y); c.rotate(l.rot); c.scale(1, Math.abs(Math.sin(l.rot * 1.7)) * .8 + .2); c.fillStyle = l.c; c.beginPath(); c.ellipse(0, 0, l.s, l.s * .45, 0, 0, 7); c.fill(); c.restore(); });
      if (SCN === 'wind' && !light) { c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = .8; for (var q = 0; q < 14; q++) { var yy = (q * 37 + t * 20) % (H * .9), xx = (W + 200) - ((t * 900 + q * 173) % (W + 400)); c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx + 60 + (q % 3) * 30, yy - 3); c.stroke(); } }
      if (flash > 0 && !light) { c.fillStyle = 'rgba(210,222,255,' + (flash * .22) + ')'; c.fillRect(0, 0, W, H); }
    }
    for (var w0 = 0; w0 < 90; w0++) step(1 / 30);    // 预热：积雪、水珠、云都已经在
    return { step: step, draw: function () { drawBack(); drawFront(); }, scene: SCN, idle: function () { return !drops.length && !flakes.length && !clouds.length && !leaves.length && !stars.length && SCN !== 'sun'; } };
  }

  // 天气 → 场景
  function sceneOf(icon, curText, windLv, night) {
    if (windLv >= 6 && !/雨|雪|雷/.test(curText || '')) return 'wind';
    if (icon === 'storm') return 'storm';
    if (icon === 'rain') return 'rain';
    if (icon === 'snow') return 'snow';
    if (icon === 'fog') return 'fog';
    if (icon === 'moon' || (night && (icon === 'sun' || icon === 'partly'))) return 'night';
    if (icon === 'sun' || icon === 'partly') return 'sun';
    return 'cloudy';
  }
  var SKY = { sun: ['#3f7fbf', '#d49c7c'], cloudy: ['#5d6880', '#9098a8'], rain: ['#15293a', '#2c4556'], storm: ['#0d1126', '#252b45'], snow: ['#7b90a8', '#b9c6d4'], fog: ['#9aa3a7', '#c3c9cb'], night: ['#050918', '#18203d'], wind: ['#58788a', '#9fae9d'] };
  return { create: create, sceneOf: sceneOf, SKY: SKY };
})();
