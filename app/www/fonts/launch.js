/* 云朵天气 5.10 · 启动动画「Amor」
 * 一个镜头到底：纸带写出的 A → 定格（下面浮出 A M O R）→ 慢推、越推越快 → 钻进 A 的左笔 → 红色碎成一束束斜光，
 * 光束很快褪成透明的水：壁纸在每一束下面被折射（wall.js uS），黑底退开 → 光束散开、变细、消失；快散完时 onOpen：字和按钮依次出来。动效期间壁纸在后台解码、编译着色器；没准备好就把「慢推」多拖一会儿（最多 0.8 秒）。
 * 用法：Launch.mount()（尽早，盖一层黑）→ App 首次渲染后 Launch.start({ ready: fn, onReveal: fn, onDone: fn })。轻点跳过。
 */
window.Launch = (function () {
  'use strict';
  var cv = null, ctx = null, W = 0, H = 0, D = 1, raf = 0, t0 = 0, opt = {}, skipAt = 0, revealed = false, opened = false, finished = false, diveAt = 0;
  var T = { build: 0.42, hold: 0.85, push: 1.55, maxWait: 0.8, dive: 0.45, burst: 1.3 };

  function mount() {
    if (cv) return;
    cv = document.createElement('canvas'); cv.id = 'launch'; cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:300;background:#0b0d10;touch-action:none';
    (document.body || document.documentElement).appendChild(cv);
    size(); addEventListener('resize', size);
    cv.addEventListener('pointerdown', function () { if (!skipAt && t0) skipAt = now(); });
  }
  function size() { D = Math.min(1.75, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; if (cv) { cv.width = Math.round(W * D); cv.height = Math.round(H * D); ctx = cv.getContext('2d'); } }
  function now() { return performance.now() / 1000; }


  // A 的几何（单位盒 200×240，原点左上）：左笔、右笔、横笔，都是纸带
  var AW = 200, AH = 240;
  var LEG_L = [[14, 240], [66, 240], [124, 0], [80, 0]];
  var LEG_R = [[80, 0], [124, 0], [188, 240], [136, 240]];
  var BAR = [[46, 150], [154, 150], [161, 178], [39, 178]];
  function poly(p, k) { ctx.beginPath(); p.forEach(function (q, i) { var x = q[0], y = q[1]; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function cl(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function eo(t) { return 1 - Math.pow(1 - t, 3); }

  function drawA(t, cam) {
    // 生成：左笔从下往上 0–0.16s，右笔从上往下 0.13–0.29s，横笔从左往右 0.27–0.42s
    var pl = cl(t / 0.16), pr = cl((t - 0.13) / 0.16), pb = cl((t - 0.27) / 0.15);
    var fold = cl((t - T.push + 0.2) / 0.35);   // 推近末段：右笔和横笔折走、让开
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(cam.s, cam.s); ctx.translate(-cam.x, -cam.y);
    // 横笔（在两条腿后面）
    if (pb > 0 && fold < 1) {
      ctx.save(); ctx.globalAlpha = 1 - fold; ctx.translate(fold * 90, 0);
      ctx.beginPath(); ctx.rect(39, 140, 122 * pb, 50); ctx.clip(); poly(BAR); ctx.fillStyle = '#a5303d'; ctx.fill(); ctx.restore();
    }
    // 左笔
    if (pl > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 240 - 240 * pl, AW, 240 * pl); ctx.clip(); poly(LEG_L);
      var gl = ctx.createLinearGradient(14, 0, 124, 0); gl.addColorStop(0, '#c23c48'); gl.addColorStop(1, '#d84a52'); ctx.fillStyle = gl; ctx.fill(); ctx.restore();
    }
    // 右笔（盖在左笔上，顶端有折痕阴影）
    if (pr > 0 && fold < 1) {
      ctx.save(); ctx.globalAlpha = 1 - fold; ctx.translate(fold * 140, fold * 30);
      ctx.beginPath(); ctx.rect(0, 0, AW + 10, 240 * pr); ctx.clip(); poly(LEG_R);
      ctx.fillStyle = '#e45a5c'; ctx.fill();
      var sh = ctx.createLinearGradient(0, 0, 0, 120), k = cl((t - 0.3) / 0.4);
      sh.addColorStop(0, 'rgba(60,0,10,' + (0.5 * k) + ')'); sh.addColorStop(1, 'rgba(60,0,10,0)');
      poly(LEG_R); ctx.fillStyle = sh; ctx.fill();
      // 推近时右笔拖出一点残影
      if (fold > 0) { ctx.globalAlpha = (1 - fold) * .4; ctx.translate(-14, 0); poly(LEG_R); ctx.fillStyle = '#e45a5c'; ctx.fill(); }
      ctx.restore();
    }
    ctx.restore();
  }
  function word(t, cam) {   // A M O R：定格时在 A 下面浮出来，推近时先散掉
    var a = cl((t - 0.45) / 0.3) * (1 - cl((t - 1.0) / 0.25));
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#f4ece0';
    ctx.font = '600 ' + Math.round(17 * Math.min(1.4, cam.s / cam.s0)) + 'px "Cormorant Garamond", "Amor Latin", Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var y = H / 2 + (AH / 2 + 26) * cam.s, txt = 'A  M  O  R';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.fillText(txt, W / 2, y + (1 - eo(cl((t - 0.5) / 0.35))) * 8);
    ctx.restore();
  }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function frame() {
    raf = 0; if (finished) return;
    var t = now() - t0;
    if (skipAt) { var q = cl((now() - skipAt) / 0.28); cv.style.opacity = 1 - q; if (!revealed) reveal({ skip: true }); if (!opened) open(); if (q >= 1) return done(); raf = requestAnimationFrame(frame); return; }
    ctx.setTransform(D, 0, 0, D, 0, 0);
    // 镜头：A 先占屏宽的 34%；定格后慢推，越推越快；钻进左笔的中间
    var s0 = Math.min(W * 0.34 / AW, H * 0.26 / AH), ready = !opt.ready || opt.ready();
    if (!diveAt && t >= T.push && (ready || t >= T.push + T.maxWait)) diveAt = t;
    var tp = Math.max(0, t - T.hold), pushEnd = diveAt || Math.max(t, T.push);
    var s = s0 * (1 + 0.1 * tp + 1.1 * tp * tp);             // 慢 → 快
    var tx = AW / 2, ty = AH / 2, tgtx = 64, tgty = 150;       // 左笔中段
    var dv = diveAt ? cl((t - diveAt) / T.dive) : 0;
    var focus = cl((tp - 0.4) / (pushEnd - T.hold));
    var cam = { s0: s0, s: s * (1 + Math.pow(dv, 2.2) * 60), x: lerp(tx, tgtx, eo(focus * 0.6 + dv * 0.4)), y: lerp(ty, tgty, eo(focus * 0.6 + dv * 0.4)) };
    // 钻进左笔后：整屏是 A 的红 → 碎成一束束斜光，光束很快褪成透明的「水」：壁纸在每一束下面被折射、边上亮一点（wall.js uS），
    // 黑底同时退开；光束向两边散开、变细、一根根消失，壁纸平静下来
    var bp = diveAt ? (t - diveAt - T.dive * 0.75) / T.burst : -1;
    ctx.clearRect(0, 0, W, H);
    if (bp < 0) {
      ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, W, H);
      drawA(t, cam); word(t, cam); field_ = null;
    } else {
      if (!strands.length) makeStrands();
      if (!revealed) { if (cv.style.background) cv.style.background = ''; reveal({ skip: false, strands: true }); }
      var ang = LEG_ANG, nx = Math.cos(ang), ny = Math.sin(ang), cx = W / 2, cy = H / 2, list = [];
      strands.forEach(function (st) {
        var life = cl(bp / 0.06) * (1 - cl((bp - st.die) / 0.22));
        if (life <= 0) return;
        var x = (st.u - .5) * SPAN * (0.32 + 1.25 * eo(cl(bp))) + st.v * bp * 140, w = st.w * (1 + bp * 0.8) * (0.5 + 0.5 * life);
        list.push([x, w / 2, st.a * life, st.c]);
      });
      field_ = { cx: cx, cy: cy, nx: nx, ny: ny, list: list };
      var dark = 1 - cl((bp - 0.04) / 0.42), red = 1 - cl(bp / 0.16), tint = 1 - cl(bp / 0.4);
      if (dark > 0) { ctx.globalAlpha = dark * (1 - red); ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, W, H); }
      if (red > 0) { ctx.globalAlpha = red; ctx.fillStyle = '#c8434e'; ctx.fillRect(0, 0, W, H); }
      ctx.globalAlpha = 1;
      // 光束本身：刚碎开时还带颜色，很快只剩两道细亮边 + 一层极淡的水色（透明）
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang); var L = Math.hypot(W, H);
      list.forEach(function (q) {
        var x = q[0], hw = q[1], a = q[2];
        if (tint > 0) { ctx.globalAlpha = a * tint * 0.75; ctx.fillStyle = q[3]; ctx.fillRect(x - hw, -L, hw * 2, L * 2); }
        ctx.globalCompositeOperation = 'lighter';
        var g = ctx.createLinearGradient(x - hw, 0, x + hw, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.06, 'rgba(235,245,255,' + (a * 0.32) + ')'); g.addColorStop(.18, 'rgba(255,255,255,' + (a * 0.04) + ')');
        g.addColorStop(.82, 'rgba(255,255,255,' + (a * 0.04) + ')'); g.addColorStop(.94, 'rgba(235,245,255,' + (a * 0.32) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x - hw, -L, hw * 2, L * 2);
        ctx.globalCompositeOperation = 'source-over';
      });
      ctx.restore(); ctx.globalAlpha = 1;
      if (!opened && bp > 0.5) open();   // 光束快散完：时间、问候、回信栏、导航依次出来
      if (bp >= 1) { field_ = null; return done(); }
    }
    raf = requestAnimationFrame(frame);
  }
  // 光束：和左笔一样斜；位置是垂直于光束方向的坐标（CSS 像素，相对屏幕中心）
  var LEG_ANG = Math.atan2(240, 124 - 66) - Math.PI / 2, SPAN = 0, strands = [], field_ = null;
  var TINT = ['#d24e57', '#e8774f', '#f2c7a0', '#6fb7c6', '#4f86cf', '#e0565a'];
  function makeStrands() {
    SPAN = Math.hypot(W, H); strands = [];
    for (var i = 0; i < 22; i++) strands.push({ u: Math.random(), w: 14 + Math.random() * 58, v: (Math.random() - .5) * 2, die: 0.35 + Math.random() * 0.55, a: 0.55 + Math.random() * 0.45, c: TINT[(Math.random() * TINT.length) | 0] });
    strands.push({ u: .5, w: 26, v: 0, die: 0.8, a: 1, c: '#e0565a' });
  }
  function open() { opened = true; try { opt.onOpen && opt.onOpen(); } catch (e) {} }
  function reveal(o) { revealed = true; try { opt.onReveal && opt.onReveal(o || {}); } catch (e) {} }
  function done() {
    finished = true; if (raf) cancelAnimationFrame(raf); if (!opened) open();
    removeEventListener('resize', size);
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
    cv = null; try { opt.onDone && opt.onDone(); } catch (e) {}
  }
  function start(o) {
    opt = o || {}; if (!cv) mount(); t0 = now(); raf = requestAnimationFrame(frame);
  }
  function skip() { if (!skipAt) skipAt = now(); }
  return { field: function () { return finished ? null : field_; }, mount: mount, start: start, skip: skip, active: function () { return !!cv && !finished; }, T: T };
})();
