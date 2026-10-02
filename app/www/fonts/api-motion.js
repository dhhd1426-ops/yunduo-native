/* 云朵天气 · API 设置页三个控件的动效组件：ApiMo.test（测试连接）/ ApiMo.save（保存）/ ApiMo.refresh（刷新）。
   无第三方库。唯二的循环动画：测试「连接中」的光带与图标轻推、刷新等待数据时的匀速旋转；结束、页面不可见、减少动态时都会停。
   用法：html += ApiMo.test.html(key, {attr}) …；每次渲染后调 ApiMo.after()；状态变化调 ApiMo.test.begin/done、ApiMo.save.click/setDirty、ApiMo.refresh.start/finish。
   重画整页时按「已经画出来的状态」先画，after() 再切到最新状态并播过渡，所以动画接得上。 */
var ApiMo = (function () {
  'use strict';
  // ===== 动画参数（都在这里调）=====
  var C = {
    ok: '#7fb88a', err: '#e07a6e',                 // 成功 / 失败色（强调色取壁纸主题色，CSS 里 --ap-acc）
    pressScale: 0.97, pressMs: 120,                // 按下
    nudgePx: 3, nudgeMs: 500, bandMs: 1000,        // 连接中：图标左右轻推、底部光带周期
    dropPx: 8, dropMs: 400,                        // 成功：图标从上方落下
    shakePx: 6, shakeMs: 400,                      // 失败：水平抖动（±6 递减）
    washAlpha: 0.35, washMs: 260,                  // 背景泛色（CSS 里也是 .35）
    resetMs: 2200,                                 // 回到空闲
    stiffness: 300, damping: 20,                   // 弹簧（落下 / 盖章 回弹）
    popFrom: 1, popPeak: 1.08, popMs: 300,         // 保存：第一次亮起弹一下
    flipMs: 500, flipPerspective: 300, flipFold: 0.45, swapMs: 250,   // 纸片收起：总时长、透视、折到 90° 的时间点、换 ✓ 的时刻
    stampFrom: 2.2, stampMs: 300,                  // ✓ 盖章
    savedMs: 1400, failMs: 1500,                   // 已保存 / 保存失败 停留
    rfPull: 5, rfPullFrac: 0.2, rfTurnFrac: 0.7, rfOverY: 2, rfOverDeg: 10, rfTotalMs: 900, rfSpinMs: 700   // 刷新
  };
  var slow = 1;                                   // 预览页慢放倍数（时长和定时器都乘它）
  var opts = { calm: false };                     // 预览页：模拟「减少动态效果」
  var live = [], easeStr = null;

  function calm() { return opts.calm || !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || !Element.prototype.animate; }
  function T(ms) { return ms * slow; }
  function spring() {
    if (easeStr) return easeStr;
    var w0 = Math.sqrt(C.stiffness), z = C.damping / (2 * w0), tEnd = Math.log(50) / (z * w0), wd = w0 * Math.sqrt(1 - z * z), pts = [], N = 40;
    for (var i = 0; i <= N; i++) { var t = tEnd * i / N; pts.push(+(1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t))).toFixed(4)); }
    pts[N] = 1; var ok = false; try { ok = window.CSS && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)'); } catch (e) {}
    easeStr = ok ? 'linear(' + pts.join(',') + ')' : 'cubic-bezier(.34,1.45,.5,1)'; return easeStr;
  }
  // 统一的动画入口：乘慢放倍数；登记以便「看不见就停」；返回 Animation
  function A(el, kf, o) {
    if (!el || !el.animate) return null;
    o = Object.assign({}, o); o.duration = T(o.duration || 0); if (o.delay) o.delay = T(o.delay);
    var a; try { a = el.animate(kf, o); } catch (e) { return null; }
    live.push(a); var rm = function () { var i = live.indexOf(a); if (i >= 0) live.splice(i, 1); }; a.finished.then(rm, rm); return a;
  }
  function hap(level) {   // 0 轻点 · 1 嗒 · 2 中等 · 3 稍重
    try { if (window.AmorNative && typeof AmorNative.hapticLevel === 'function' && AmorNative.hapticLevel(level)) return; } catch (e) {}
    try { navigator.vibrate && navigator.vibrate([8, 12, 18, 28][level] || 10); } catch (e) {}
  }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function find(kind, key) { return q('[data-ap="' + kind + ':' + key + '"]'); }
  function reason(msg) {   // 把接口报错压成一小段原因
    var s = String(msg || ''); if (/401|403|密钥|key|unauthor|invalid.*(key|token)|鉴权|认证/i.test(s)) return '密钥无效';
    if (/超时|timeout|timed out/i.test(s)) return '超时'; if (/网络|network|failed to fetch|断开|连不上/i.test(s)) return '网络不通';
    if (/404/.test(s)) return '地址不对'; if (/429|额度|余额|quota|rate/i.test(s)) return '额度或频率受限'; if (/5\d\d/.test(s)) return '服务出错';
    s = s.replace(/\s+/g, ' ').trim(); return s.length > 14 ? s.slice(0, 13) + '…' : (s || '未知原因');
  }

  /* ================= 1. 测试连接 ================= */
  var TR = {};   // key → { phase, painted, ms, why, timer }
  var PLUG = '<svg class="ap-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<g class="p-sock"><path d="M5 2.2h14"/></g><g class="p-plug"><path d="M9 4.2v3.6M15 4.2v3.6"/><path d="M6.5 7.8h11v3.4a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.7v4.6"/></g>' +
    '<g class="p-bad"><path d="M3 11l2.2.9M21 11l-2.2.9M2.6 16l2.4-.4M21.4 16l-2.4-.4"/></g><g class="p-chk"><path d="M17 18.4l2.2 2.2 3.6-4"/></g></svg>';
  function tText(r, ph) { return ph === 'load' ? '连接中…' : ph === 'ok' ? '连接成功 · ' + r.ms + ' ms' : ph === 'err' ? '连接失败 · ' + r.why : '测试连接'; }
  var test = {
    html: function (key, o) {
      o = o || {}; var r = TR[key] || (TR[key] = { phase: 'idle', painted: 'idle', ms: 0, why: '' }), ph = r.painted;
      return '<div class="ap-slot"><button type="button" class="ap-test ph-' + ph + '" data-ap="test:' + esc(key) + '" ' + (o.attr || '') + ' aria-live="polite"' + (ph === 'load' ? ' aria-busy="true"' : '') + '>' +
        '<span class="ap-ic">' + PLUG + '</span><span class="ap-tx">' + esc(tText(r, ph)) + '</span><i class="ap-band"></i></button></div>';
    },
    begin: function (key) {          // 开始连接；已经在连接中 → 忽略（返回 false）
      var r = TR[key] || (TR[key] = { phase: 'idle', painted: 'idle', ms: 0, why: '' });
      if (r.phase === 'load') return false;
      clearTimeout(r.timer); r.phase = 'load'; hap(0); paintTest(key); return true;
    },
    done: function (key, ok, info) {   // info: ms（成功）或 msg（失败）
      var r = TR[key]; if (!r) return; clearTimeout(r.timer);
      r.phase = ok ? 'ok' : 'err'; r.ms = (info && info.ms) || 0; r.why = ok ? '' : reason(info && info.msg);
      paintTest(key); hap(ok ? 1 : 3); if (ok) setTimeout(function () { hap(1); }, T(110));
      r.timer = setTimeout(function () { r.phase = 'idle'; paintTest(key); }, T(C.resetMs));
    },
    phase: function (key) { return TR[key] ? TR[key].phase : 'idle'; }
  };
  var bandAnim = {}, nudgeAnim = {};
  function stopLoops(key) { [bandAnim, nudgeAnim].forEach(function (m) { if (m[key]) { try { m[key].cancel(); } catch (e) {} delete m[key]; } }); }
  function paintTest(key, noAnim) {
    var r = TR[key], el = find('test', key); if (!r || !el) { if (r) r.painted = r.phase; return; }
    var from = r.painted, to = r.phase; if (from === to && !noAnim) return;
    r.painted = to;
    var tx = q('.ap-tx', el), ic = q('.ap-ic', el), animate = !calm() && !document.hidden && !noAnim;
    el.classList.remove('ph-idle', 'ph-load', 'ph-ok', 'ph-err'); el.classList.add('ph-' + to);
    if (to === 'load') el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
    tx.textContent = tText(r, to);
    stopLoops(key);
    if (!animate) return;
    A(tx, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    if (to === 'load') startLoops(key, el);
    else if (to === 'ok') {
      A(ic, [{ transform: 'translateY(' + (-C.dropPx) + 'px)', opacity: .2 }, { transform: 'translateY(0)', opacity: 1 }], { duration: C.dropMs, easing: spring() });
    } else if (to === 'err') {
      var s = C.shakePx; A(el, [{ translate: '0 0' }, { translate: -s + 'px 0' }, { translate: s * .8 + 'px 0' }, { translate: -s * .55 + 'px 0' }, { translate: s * .35 + 'px 0' }, { translate: -s * .15 + 'px 0' }, { translate: '0 0' }], { duration: C.shakeMs, easing: 'ease-out' });
    }
  }
  function startLoops(key, el) {
    stopLoops(key); var ic = q('.ap-ic', el), band = q('.ap-band', el);
    nudgeAnim[key] = A(ic, [{ transform: 'translateX(' + (-C.nudgePx) + 'px)' }, { transform: 'translateX(' + C.nudgePx + 'px)' }], { duration: C.nudgeMs, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    if (band) bandAnim[key] = A(bandSweep(band), [{ transform: 'translateX(-100%)' }, { transform: 'translateX(250%)' }], { duration: C.bandMs, iterations: Infinity, easing: 'linear' });
    if (nudgeAnim[key]) nudgeAnim[key].__el = el;
  }
  // 光带用一个真实子元素，不能直接动画：改用一个真实子元素
  function bandSweep(band) { var b = q('b', band); if (!b) { b = document.createElement('b'); b.style.cssText = 'position:absolute;inset:0;width:40%;background:linear-gradient(90deg,transparent,var(--ap-acc),transparent)'; band.appendChild(b); } return b; }

  /* ================= 2. 保存 ================= */
  var SR = {};   // key → { phase: clean|dirty|saving|saved|fail, painted, timer }
  var CHECK = '<svg class="ap-sv-ck" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.8l4.2 4.2 8.8-9.6"/></svg>';
  function sText(ph) { return ph === 'fail' ? '保存失败' : '保存'; }
  var save = {
    html: function (key, o) {
      o = o || {}; var r = SR[key];
      if (!r) r = SR[key] = { phase: o.dirty ? 'dirty' : 'clean', painted: o.dirty ? 'dirty' : 'clean' };
      else if ((r.phase === 'clean' || r.phase === 'dirty') && !!o.dirty !== (r.phase === 'dirty')) r.phase = o.dirty ? 'dirty' : 'clean';
      var ph = r.painted;
      return '<div class="ap-sv"><button type="button" class="ap-save ph-' + ph + '" data-ap="save:' + esc(key) + '" ' + (o.attr || '') + ' aria-disabled="' + (ph === 'clean') + '">' +
        '<span class="ap-sv-tx">' + sText(ph) + '</span>' + CHECK + '</button></div>';
    },
    setDirty: function (key, dirty) {   // 输入框变化时调
      var r = SR[key]; if (!r || r.phase === 'saving') return;
      if (r.phase === 'saved' || r.phase === 'fail') { if (!dirty) return; clearTimeout(r.timer); }
      var to = dirty ? 'dirty' : 'clean'; if (r.phase === to) return; r.phase = to; paintSave(key);
    },
    click: function (key, fn) {   // fn() 返回 true = 保存成功；其它 = 失败
      var r = SR[key]; if (!r || r.phase !== 'dirty') return false;
      var ok = false; try { ok = fn() !== false; } catch (e) { ok = false; }
      clearTimeout(r.timer);
      if (ok) { r.phase = 'saving'; paintSave(key); r.timer = setTimeout(function () { r.phase = 'saved'; paintSave(key); r.timer = setTimeout(function () { r.phase = 'clean'; paintSave(key); }, T(C.savedMs)); }, T(calm() ? 0 : C.swapMs)); }
      else { r.phase = 'fail'; paintSave(key); r.timer = setTimeout(function () { r.phase = 'dirty'; paintSave(key); }, T(C.failMs)); }
      return true;
    },
    phase: function (key) { return SR[key] ? SR[key].phase : 'clean'; }
  };
  function paintSave(key) {
    var r = SR[key], el = find('save', key); if (!r || !el) { if (r) r.painted = r.phase === 'saving' ? 'dirty' : r.phase; return; }
    var from = r.painted, to = r.phase, tx = q('.ap-sv-tx', el), animate = !calm() && !document.hidden;
    if (to === 'saving') {   // 纸片收起：先翻到 90°（按钮样式不变），到 swapMs 再换 ✓（click 里的定时器切到 saved）
      hap(2); r.painted = 'saving';
      if (animate) {
        var f = C.flipFold, wrap = el.parentNode; wrap.style.perspective = C.flipPerspective + 'px';
        A(el, [{ transform: 'rotateX(0deg)', offset: 0 }, { transform: 'rotateX(-90deg)', offset: f }, { transform: 'rotateX(90deg)', offset: f + 1e-4 }, { transform: 'rotateX(0deg)', offset: 1 }], { duration: C.flipMs, easing: 'linear' });
      }
      return;
    }
    r.painted = to;
    el.classList.remove('ph-clean', 'ph-dirty', 'ph-saving', 'ph-saved', 'ph-fail'); el.classList.add('ph-' + to);
    el.setAttribute('aria-disabled', String(to === 'clean')); tx.textContent = sText(to);
    if (!animate || from === to) return;
    if (to === 'dirty' && from === 'clean') A(el, [{ scale: C.popFrom }, { scale: C.popPeak, offset: .45 }, { scale: 1 }], { duration: C.popMs, easing: 'ease-out' });
    else if (to === 'saved') A(q('.ap-sv-ck', el), [{ transform: 'scale(' + C.stampFrom + ')', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: C.stampMs, easing: spring(), fill: 'backwards' });
    else if (to === 'fail') { var s = C.shakePx; A(el, [{ translate: '0 0' }, { translate: -s + 'px 0' }, { translate: s * .8 + 'px 0' }, { translate: -s * .55 + 'px 0' }, { translate: s * .35 + 'px 0' }, { translate: '0 0' }], { duration: C.shakeMs, easing: 'ease-out' }); hap(3); }
    else if (to === 'clean' && from === 'saved') A(tx, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
  }

  /* ================= 3. 刷新 ================= */
  var RR = {};   // key → { run, pending, phase, spin, cb }
  var refresh = {
    html: function (key, o) {
      o = o || {};
      return '<button type="button" class="ap-rf" data-ap="rf:' + esc(key) + '" ' + (o.attr || '') + ' aria-label="' + esc(o.label || '刷新') + '">' + (o.svg || '') + '</button>';
    },
    start: function (key) {
      var r = RR[key] || (RR[key] = {}); if (r.run) return false;
      r.run = true; r.pending = true; r.phase = 'pull'; r.cb = null; hap(0);
      var el = find('rf', key); if (!el || calm() || document.hidden) { r.phase = 'plain'; return true; }
      var a = A(el, [{ translate: '0 0' }, { translate: '0 ' + C.rfPull + 'px' }], { duration: C.rfTotalMs * C.rfPullFrac, easing: 'ease-out', fill: 'forwards' });
      (a ? a.finished : Promise.resolve()).then(function () { if (RR[key] !== r || !r.run) return; r.phase = 'turn'; (r.pending ? spinUp : turnOnce)(key, r); }, function () {});
      return true;
    },
    finish: function (key, cb) {
      var r = RR[key]; if (!r || !r.run) { if (cb) cb(); return; }
      r.pending = false; r.cb = cb;
      if (r.phase === 'plain') { r.run = false; if (cb) cb(); return; }
      if (r.phase === 'spin') landSpin(key, r);   // 其它阶段（pull / turn）会在自己结束时衔接
    },
    busy: function (key) { return !!(RR[key] && RR[key].run); }
  };
  function rfEl(key) { return find('rf', key); }
  function turnOnce(key, r) {   // 请求已经回来：转一圈回到原位，再收尾
    var el = rfEl(key), ms = C.rfTotalMs * (C.rfTurnFrac - C.rfPullFrac);
    if (!el) return rfEnd(key, r);
    A(el, [{ translate: '0 ' + C.rfPull + 'px' }, { translate: '0 0' }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    var a = A(el, [{ rotate: '0deg' }, { rotate: '360deg' }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    (a ? a.finished : Promise.resolve()).then(function () { rfEnd(key, r); }, function () {});
  }
  function spinUp(key, r) {     // 请求还没回来：边回位边匀速转
    var el = rfEl(key); if (!el) { r.phase = 'spin'; return; }
    A(el, [{ translate: '0 ' + C.rfPull + 'px' }, { translate: '0 0' }], { duration: C.rfTotalMs * (C.rfTurnFrac - C.rfPullFrac), easing: 'ease-in-out', fill: 'forwards' });
    r.spin = A(el, [{ rotate: '0deg' }, { rotate: '360deg' }], { duration: C.rfSpinMs, iterations: Infinity, easing: 'linear' });
    r.phase = 'spin'; if (!r.pending) landSpin(key, r);
  }
  function landSpin(key, r) {   // 数据回来了：转到下一个整圈再收尾，不突然停
    var el = rfEl(key), sp = r.spin; r.phase = 'land';
    if (!el || !sp) return rfEnd(key, r);
    var per = T(C.rfSpinMs), ang = ((sp.currentTime || 0) % per) / per * 360, remain = 360 - ang; if (remain < 80) remain += 360;
    try { sp.cancel(); } catch (e) {} r.spin = null;
    var a = A(el, [{ rotate: ang + 'deg' }, { rotate: (ang + remain) + 'deg' }], { duration: remain / 360 * C.rfSpinMs * 1.2, easing: 'cubic-bezier(.25,.7,.3,1)', fill: 'forwards' });
    (a ? a.finished : Promise.resolve()).then(function () { rfEnd(key, r); }, function () {});
  }
  function rfEnd(key, r) {      // 略过冲：向上 2px、多转 10°，再落回
    var el = rfEl(key), seg = C.rfTotalMs * (1 - C.rfTurnFrac) / 2;
    function fin() { if (el) { Array.prototype.forEach.call(el.getAnimations ? el.getAnimations() : [], function (x) { try { x.cancel(); } catch (e) {} }); } r.run = false; r.phase = ''; var cb = r.cb; r.cb = null; if (cb) cb(); }
    if (!el || calm()) return fin();
    r.phase = 'end';
    A(el, [{ translate: '0 0' }, { translate: '0 ' + (-C.rfOverY) + 'px' }], { duration: seg, easing: 'ease-out', fill: 'forwards' });
    var a1 = A(el, [{ rotate: '360deg' }, { rotate: (360 + C.rfOverDeg) + 'deg' }], { duration: seg, easing: 'ease-out', fill: 'forwards' });
    (a1 ? a1.finished : Promise.resolve()).then(function () {
      A(el, [{ translate: '0 ' + (-C.rfOverY) + 'px' }, { translate: '0 0' }], { duration: seg, easing: 'ease-in-out', fill: 'forwards' });
      var a2 = A(el, [{ rotate: (360 + C.rfOverDeg) + 'deg' }, { rotate: '360deg' }], { duration: seg, easing: 'ease-in-out', fill: 'forwards' });
      (a2 ? a2.finished : Promise.resolve()).then(fin, fin);
    }, function () {});
  }

  /* ================= 公共 ================= */
  function after() {   // 每次渲染后调：把已画出的旧状态接到最新状态
    Array.prototype.forEach.call(document.querySelectorAll('[data-ap^="test:"]'), function (el) {
      var k = el.getAttribute('data-ap').slice(5), r = TR[k]; if (!r) return;
      if (r.painted !== r.phase) paintTest(k);
      else if (r.phase === 'load' && !calm() && !document.hidden && (!nudgeAnim[k] || nudgeAnim[k].__el !== el)) startLoops(k, el);   // 连接中途页面被重画：把循环接到新按钮上
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ap^="save:"]'), function (el) { var k = el.getAttribute('data-ap').slice(5), r = SR[k]; if (r && r.painted !== r.phase && r.phase !== 'saving') paintSave(k); });
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', function (e) { var b = e.target.closest && e.target.closest('.ap-test'); if (b && !calm()) b.classList.add('pr'); }, true);
    var upAll = function () { Array.prototype.forEach.call(document.querySelectorAll('.ap-test.pr'), function (b) { b.classList.remove('pr'); }); };
    document.addEventListener('pointerup', upAll, true); document.addEventListener('pointercancel', upAll, true);
    document.addEventListener('visibilitychange', function () {   // 看不见就停：循环动画暂停，其余直接收尾
      live.slice().forEach(function (a) { try { if (document.hidden) { if (a.effect && a.effect.getTiming().iterations === Infinity) a.pause(); else a.finish(); } else if (a.playState === 'paused') a.play(); } catch (e) {} });
    });
  }
  return { C: C, opts: opts, test: test, save: save, refresh: refresh, after: after, hap: hap, reason: reason, setSlow: function (n) { slow = n || 1; if (typeof document !== 'undefined') document.documentElement.style.setProperty('--ap-slow', slow); }, calm: calm };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ApiMo;
