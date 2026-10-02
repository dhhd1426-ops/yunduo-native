/* 云朵天气 · 开关（Switch）统一动效组件。无第三方库、没有循环动画。
   用法：html += SwX.html('clock'|'star'|'spark', key, on, label, 'data-xxx');  渲染后调 SwX.after();  点击时调 SwX.haptic(新状态)。
   重画整页时先按「上一次的状态」画，渲染后 after() 再切到新状态并播动画，所以动画能接得上。 */
var SwX = (function () {
  'use strict';
  // ===== 动画参数（都在这里调）=====
  var C = {
    stiffness: 280, damping: 21, mass: 1,   // 弹簧：ζ≈0.63，过冲约 8%，约 370ms 落定
    squash: 1.3,                             // 按下时滑块横向拉长倍数
    travel: 20,                              // 滑块行程 px（轨道 52 − 滑块 26 − 边距 2×3 = 20）
    trackMs: 280, fillR: 46,                 // 轨道径向洇色时长、最终半径（要盖住最远的角）
    glowPx: 12, glowMs: 500, glowFrom: 0.9,  // 开启光晕：外扩 12px，透明度 0.9→0
    rippleMs: 460, rippleFrom: 0.6, rippleTo: 2.2, rippleAlpha: 0.55,   // 启用记忆：涟漪
    clockMs: 380, sparkMs: 420, sparkPeak: 1.5, sparkSpin: 12,          // 时钟转一圈、✦ 放大到 1.5 倍再落回
    maxMs: 400                               // 弹簧动画时长上限
  };
  var ICONS = {
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 12l3.2 2"/><path class="hand" d="M12 12V6.2"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.7 6.3 20l1.4-6.3L2.9 9.4l6.4-.7z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.8 6 4 9.2 10 10-6 .8-9.2 4-10 10-.8-6-4-9.2-10-10 6-.8 9.2-4 10-10z"/></svg>'
  };
  var SwX_opts = { calm: false };   // 预览页用：模拟「减少动态效果」
  var last = {}, pend = {}, live = [], easeStr = null, easeMs = 0, pendT = 0;

  // 按弹簧参数采样出 linear() 缓动曲线（0→1，带过冲）
  function spring() {
    if (easeStr) return;
    var w0 = Math.sqrt(C.stiffness / C.mass), z = C.damping / (2 * Math.sqrt(C.stiffness * C.mass)), T = Math.log(50) / (z * w0);
    var wd = w0 * Math.sqrt(Math.max(1e-6, 1 - z * z)), pts = [], N = 40;
    for (var i = 0; i <= N; i++) { var t = T * i / N, x = 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); pts.push(+x.toFixed(4)); }
    pts[N] = 1; easeMs = Math.min(C.maxMs, Math.round(T * 1000));
    var ok = false; try { ok = window.CSS && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)'); } catch (e) {}
    easeStr = ok ? 'linear(' + pts.join(',') + ')' : 'cubic-bezier(.34,1.3,.5,1)';
  }
  function calm() { return SwX_opts.calm || !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || !Element.prototype.animate; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

  function html(kind, key, on, label, attr) {
    on = !!on;
    var was = last[key], stale = was !== undefined && was !== on && !calm() && !document.hidden;
    last[key] = on;
    var shown = stale ? was : on;
    return '<div class="switch-row"><span>' + label + '</span><button type="button" class="sw2" role="switch" aria-checked="' + shown + '"' +
      (stale ? ' data-to="' + on + '"' : '') + ' aria-label="' + esc(String(label).replace(/<[^>]*>/g, '')) + '" data-sw="' + kind + '" ' + (attr || 'data-dsw') + '="' + esc(key) + '">' +
      '<span class="sw2-glow"></span><span class="sw2-fill"></span><span class="sw2-rip"></span><i class="sw2-knob">' + (ICONS[kind] || ICONS.star) + '</i></button></div>';
  }

  function track(a) { live.push(a); var rm = function () { var i = live.indexOf(a); if (i >= 0) live.splice(i, 1); }; a.finished.then(rm, rm); return a; }
  function play(el, to, squash) {
    spring();
    var knob = el.querySelector('.sw2-knob'), fill = el.querySelector('.sw2-fill'), glow = el.querySelector('.sw2-glow'), rip = el.querySelector('.sw2-rip');
    var a = to ? 0 : C.travel, b = to ? C.travel : 0, org = to ? '0 50%' : '100% 50%';
    void el.offsetWidth;                                 // 先把旧样式落一帧，颜色过渡才接得上
    el.setAttribute('aria-checked', String(to));
    try {
      track(knob.animate([{ transform: 'translateX(' + a + 'px) scaleX(' + (squash ? C.squash : 1) + ')', transformOrigin: org }, { transform: 'translateX(' + b + 'px) scaleX(1)', transformOrigin: org }], { duration: easeMs, easing: easeStr }));
      var R = C.fillR + 'px';
      track(fill.animate(to ? [{ clipPath: 'circle(0px at 17px 17px)' }, { clipPath: 'circle(' + R + ' at 17px 17px)' }] : [{ clipPath: 'circle(' + R + ' at 17px 17px)' }, { clipPath: 'circle(0px at 17px 17px)' }],
        { duration: C.trackMs, easing: 'cubic-bezier(.3,.7,.2,1)' }));
      if (!to) return;
      track(glow.animate([{ boxShadow: '0 0 0 0 color-mix(in srgb, var(--on) ' + Math.round(C.glowFrom * 100) + '%, transparent)' }, { boxShadow: '0 0 0 ' + C.glowPx + 'px color-mix(in srgb, var(--on) 0%, transparent)' }], { duration: C.glowMs, easing: 'ease-out' }));
      var kind = el.getAttribute('data-sw'), svg = knob.querySelector('svg');
      if (kind === 'clock') { var hand = knob.querySelector('.hand'); hand.style.transformOrigin = '12px 12px'; track(hand.animate([{ transform: 'rotate(-360deg)' }, { transform: 'rotate(0deg)' }], { duration: Math.min(C.maxMs, C.clockMs), easing: easeStr })); }
      else if (kind === 'star') track(rip.animate([{ transform: 'translateX(' + C.travel + 'px) scale(' + C.rippleFrom + ')', opacity: C.rippleAlpha }, { transform: 'translateX(' + C.travel + 'px) scale(' + C.rippleTo + ')', opacity: 0 }], { duration: C.rippleMs, easing: 'cubic-bezier(.2,.7,.3,1)' }));
      else if (kind === 'spark') track(svg.animate([{ transform: 'scale(.3) rotate(-' + C.sparkSpin + 'deg)' }, { transform: 'scale(' + C.sparkPeak + ') rotate(' + (C.sparkSpin / 2) + 'deg)', offset: .55 }, { transform: 'scale(1) rotate(0deg)' }], { duration: C.sparkMs, easing: 'cubic-bezier(.3,.7,.3,1)' }));
    } catch (e) { /* 老 WebView：直接是终态 */ }
  }
  // 渲染完调用：把「旧状态」的开关切到新状态并播动画
  function after(root) {
    var els = (root || document).querySelectorAll('.sw2[data-to]');
    Array.prototype.forEach.call(els, function (el) {
      var to = el.getAttribute('data-to') === 'true'; el.removeAttribute('data-to');
      if (document.hidden || calm()) { el.setAttribute('aria-checked', String(to)); return; }
      var sq = !!pend.on; pend.on = false;
      play(el, to, sq);
    });
  }
  function haptic(on) {
    try { if (window.AmorNative && typeof AmorNative.haptic === 'function' && AmorNative.haptic(!!on)) return; } catch (e) {}
    try { navigator.vibrate && navigator.vibrate(on ? 10 : 5); } catch (e) {}
  }
  // 按下压扁 / 松手恢复（全局委托，不依赖重画）
  function down(e) { var el = e.target.closest && e.target.closest('.sw2'); if (!el) return; el.classList.add('pr'); pend.on = true; clearTimeout(pendT); }
  function up() { Array.prototype.forEach.call(document.querySelectorAll('.sw2.pr'), function (el) { el.classList.remove('pr'); }); clearTimeout(pendT); pendT = setTimeout(function () { pend.on = false; }, 450); }
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
    document.addEventListener('visibilitychange', function () { if (document.hidden) live.slice().forEach(function (a) { try { a.finish(); } catch (e) {} }); });   // 看不见就停
  }
  return { C: C, opts: SwX_opts, html: html, after: after, haptic: haptic, play: play, spring: function () { spring(); return { ease: easeStr, ms: easeMs }; } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SwX;
