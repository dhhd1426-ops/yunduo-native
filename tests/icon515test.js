// 5.15 图标微动效测试：8 种图标的终态 + 中途反向 / 快速连点 / 失败重试 / 只播一次 / 减少动态效果
// VP='[412,915]' node tests/icon515test.js
const { chromium } = require('playwright');
const fs = require('fs');
const boot = require('./_boot515.js');
const VP = JSON.parse(process.env.VP || '[412,915]');
let pass = 0, fail = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 260) : '')); c ? pass++ : fail++; };
const init = () => {
  if (!localStorage.getItem('seed515')) {
    localStorage.setItem('seed515', '1');
    const ns = JSON.parse(localStorage.getItem('cloud-weather-notes-v1') || '[]'), T = Date.now();
    ns.push({ id: 'nck', title: '采购清单', body: '周末\n- [ ] 牛奶\n- [ ] 面包\n- [x] 鸡蛋\n- [ ] 一个很长很长的事项，长到需要换行才能放得下，看看划线是不是每一行都划到', tags: [], folder: '', pin: true, paper: 'plain', date: '', created: T, updated: T + 9e6 });
    ns.push({ id: 'ndel', title: '删掉的', body: '旧的', tags: [], folder: '', paper: 'plain', date: '', created: T, updated: T, del: T });
    localStorage.setItem('cloud-weather-notes-v1', JSON.stringify(ns));
    localStorage.setItem('cloud-weather-memory-v1', JSON.stringify({ on: true, auto: true, items: [{ id: 'm1', kind: 'global', text: '住在杭州', src: 'manual', at: T }, { id: 'm2', kind: 'pref', text: '喜欢简短的回答', src: 'manual', at: T }] }));
  }
  window.__nt = { ok: true, calls: 0 };
  window.AmorNative = Object.assign(window.AmorNative || {}, {
    version: () => 1, setConfig() {}, setPlan() {}, enabled: () => true, clearLog() {}, fg() {}, takeLaunch: () => '', open: () => true,
    info: () => JSON.stringify({ enabled: true, sdk: 36, brand: 'Google', model: 'Pixel', exact: true, next: 0, planned: 0, log: [] }),
    notifyNow: () => { window.__nt.calls++; return window.__nt.ok; }
  });
};
(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] });
  for (const reduce of [false, true]) {
    const { p, ctx, errs } = await boot(b, { vp: VP, reduce, init });
    const tag = reduce ? '[减少动态] ' : '';
    const wait = ms => p.waitForTimeout(reduce ? Math.min(ms, 250) : ms);
    const tap = async sel => { const r = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; }, sel); if (!r) throw new Error('no ' + sel); await p.touchscreen.tap(r[0], r[1]); };

    // ⑦ 三条杠 → 叉：先靠拢、再转（::after 的旋转比移动晚 0.14 秒开始）
    await tap('.w-menu'); await p.waitForTimeout(60);
    if (!reduce) {
      const tr = await p.evaluate(() => document.getAnimations().filter(a => a.transitionProperty === 'transform' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.circ')).map(a => (a.effect.pseudoElement || 'i') + ':' + a.effect.getTiming().delay));
      ok('⑦ 三条杠变叉：横线先移动（无延迟），::after 旋转延后 140ms', tr.some(x => x === 'i:0') && tr.some(x => x === '::after:140'), tr);
    }
    await p.waitForFunction(() => !document.querySelector('.circ'), null, { timeout: 5000 }).catch(() => {});
    const mx = await p.evaluate(() => { const i = document.querySelectorAll('.set-x .mx i'); return [getComputedStyle(i[0], '::after').transform, getComputedStyle(i[0]).transform, getComputedStyle(i[1]).opacity]; });
    ok(tag + '⑦ 进了设置，右上角是叉（上横线下移 + 转 45°，中线隐藏）', /matrix\(0\.7/.test(mx[0]) && /5\.15/.test(mx[1]) && mx[2] === '0', mx);

    // ④ 太阳 ⇄ 月亮 + 整页颜色过渡
    const thm = () => p.evaluate(() => { const s = document.querySelector('.thm-ic'); return s && { on: s.classList.contains('on'), d: getComputedStyle(s.querySelector('.c')).d.slice(0, 22), ro: getComputedStyle(s.querySelector('.r')).opacity, dt: document.documentElement.getAttribute('data-theme') }; });
    let t0 = await thm(); ok(tag + '④ 浅色时外观旁边是太阳', t0 && !t0.on && t0.ro === '1', t0);
    await tap('[data-set="theme"][data-val="dark"]');
    if (!reduce) { await p.waitForFunction(() => { const s = document.querySelector('.thm-ic'); if (!s || !s.classList.contains('on')) return false; const d = getComputedStyle(s.querySelector('.c')).d; return !/11\.55 7\.42/.test(d) && !/11\.25 4\.44/.test(d); }, null, { timeout: 3000, polling: 16 }).then(() => ok('④ 变形中：圆的路径在连续变化（抓到了中间形状）', true), () => ok('④ 变形中：圆的路径在连续变化（抓到了中间形状）', false)); }
    await wait(1200); let t1 = await thm(); ok(tag + '④ 深色：弯月、光芒收起、页面变深', t1 && t1.on && /11\.25 4\.44/.test(t1.d) && t1.ro === '0' && t1.dt === 'dark', t1);
    if (!reduce) {   // 变到一半反向
      await tap('[data-set="theme"][data-val="light"]'); await p.waitForFunction(() => !document.querySelector('.thm-ic').classList.contains('on'), null, { timeout: 3000, polling: 16 }); await p.waitForTimeout(120); const a1 = await thm();
      await tap('[data-set="theme"][data-val="dark"]'); await p.waitForFunction(() => document.querySelector('.thm-ic').classList.contains('on'), null, { timeout: 3000, polling: 16 }); const a2 = await thm();
      const yOf = d => parseFloat(d.split(' ')[2]);   // 第一个点的 y：太阳 7.42 → 月亮 4.44
      ok('④ 变到一半反向：从当前形状接着变（不跳回太阳）', yOf(a2.d) < 7.3 && Math.abs(yOf(a2.d) - yOf(a1.d)) < 1.6, [a1.d, a2.d]);
      await p.waitForTimeout(1200); const a3 = await thm(); ok('④ 连点后停在最后点的深色', a3.on && /11\.25 4\.44/.test(a3.d), a3);
    }
    await tap('[data-set="theme"][data-val="system"]'); await wait(1200);
    t1 = await thm(); ok(tag + '④ 跟随系统（浅色）：回到太阳', t1 && !t1.on && t1.dt === null, t1);

    // ⑧ 加载环：余额查询失败 → 原位置闪叉号 → 回到刷新图标
    await tap('[data-ui="providers"]').catch(() => {}); await wait(500);
    await p.evaluate(() => { const e = document.querySelector('[data-openprov="deepseek"]'); e && e.click(); }); await wait(700);
    const hasBal = await p.evaluate(() => !!document.querySelector('[data-ui="balance"]'));
    if (hasBal) {
      await p.route(/api\.deepseek\.com\/(user\/)?balance/, async r => { await new Promise(z => setTimeout(z, 700)); r.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '{"error":{"message":"busy"}}' }); });
      await p.evaluate(() => document.querySelector('[data-ui="balance"]').click()); await p.waitForTimeout(150);
      const r1 = await p.evaluate(() => { const e = document.querySelector('[data-ui="balance"]'); return { ring: !!e.querySelector('.ldr'), dis: e.disabled, label: e.querySelector('.ldr') && e.querySelector('.ldr').getAttribute('aria-label') }; });
      await p.waitForFunction(() => document.querySelector('[data-ui="balance"] .ld-res'), null, { timeout: 8000 }).catch(() => {});
      const r2 = await p.evaluate(() => { const e = document.querySelector('[data-ui="balance"]'); return { res: e.querySelector('.ld-res') && e.querySelector('.ld-res').className, ring: !!e.querySelector('.ldr'), dis: e.disabled }; });
      await p.waitForTimeout(1300);
      const r3 = await p.evaluate(() => { const e = document.querySelector('[data-ui="balance"]'); return { res: !!e.querySelector('.ld-res'), svg: !!e.querySelector('svg:not(.ldr)') }; });
      ok(tag + '⑧ 余额：查询中是加载环（有名称、按钮禁用）', r1.ring && r1.dis && r1.label === '正在查询余额', r1);
      ok(tag + '⑧ 结束后马上停环，在原位置给结果（失败 → 叉号）', /ld-res err/.test(r2.res || '') && !r2.ring && !r2.dis, r2);
      ok(tag + '⑧ 结果闪一下就还原成刷新图标', !r3.res && r3.svg, r3);
    } else ok(tag + '⑧ 余额按钮存在', false);
    await p.evaluate(() => history.back()); await wait(400); await p.evaluate(() => history.back()); await wait(400);

    // ⑤ 纸飞机：发送中 → 圆形对勾 + 已发送；失败 → 回到按钮、可重试；发送中不重复发
    await p.evaluate(() => __goTab('settings')); await wait(500);
    await tap('[data-ui="notify"]'); await wait(900);
    await p.evaluate(() => { const e = document.querySelector('[data-nttest]'); e.click(); e.click(); e.click(); });
    const s1 = await p.evaluate(() => ({ st: document.querySelector('[data-nttest]').getAttribute('data-st'), fly: !!document.querySelector('.plane-fly'), ring: !!document.querySelector('[data-nttest] .ldr'), calls: window.__nt.calls }));
    ok(tag + '⑤ 点发送：' + (reduce ? '结果直接出来' : '纸飞机飞出、按钮转圈') + '；连点三次只发一次（两条通知 = 一次）', s1.calls === 2 && (reduce ? !s1.fly && s1.st === 'ok' : s1.st === 'busy' && s1.ring && s1.fly), s1);
    await p.waitForTimeout(800);
    const s2 = await p.evaluate(() => ({ st: document.querySelector('[data-nttest]').getAttribute('data-st'), txt: document.querySelector('[data-nttest]').textContent, ck: !!document.querySelector('[data-nttest] .ok-c'), fly: !!document.querySelector('.plane-fly') }));
    ok(tag + '⑤ 成功：原位置圆形对勾 + 已发送；飞出的纸飞机清掉了', s2.st === 'ok' && s2.ck && /已发送 2 条/.test(s2.txt) && !s2.fly, s2);
    await p.waitForTimeout(2800);
    ok(tag + '⑤ 过一会儿回到「发一条试试」', await p.evaluate(() => document.querySelector('[data-nttest]').getAttribute('data-st') === 'idle'));
    await p.evaluate(() => { window.__nt.ok = false; document.querySelector('[data-nttest]').click(); }); await p.waitForTimeout(800);
    const s3 = await p.evaluate(() => ({ st: document.querySelector('[data-nttest]').getAttribute('data-st'), txt: document.querySelector('[data-nttest]').textContent }));
    ok(tag + '⑤ 失败：回到发送入口，写着再试一次', s3.st === 'err' && /再试一次/.test(s3.txt), s3);
    await p.waitForTimeout(3000); ok(tag + '⑤ 失败状态不会自己消失（等重试）', await p.evaluate(() => document.querySelector('[data-nttest]').getAttribute('data-st') === 'err'));
    await p.evaluate(() => { window.__nt.ok = true; document.querySelector('[data-nttest]').click(); }); await p.waitForTimeout(800);
    ok(tag + '⑤ 重试成功', await p.evaluate(() => document.querySelector('[data-nttest]').getAttribute('data-st') === 'ok'));
    await p.evaluate(() => history.back()); await wait(400);

    // ⑥ 清空记忆 → 托盘晃一下、音符浮出（只播一次）
    await tap('[data-ui="memory"]'); await wait(700);
    ok(tag + '⑥ 有记忆时没有空状态', await p.evaluate(() => !document.querySelector('.etray')));
    await p.evaluate(() => document.querySelector('[data-memclear]').click()); await wait(200);
    await p.evaluate(() => document.querySelector('[data-memclear]').click()); await p.waitForTimeout(120);
    const e1 = await p.evaluate(() => { const t = document.querySelector('.etray'); return t && { play: t.classList.contains('play'), anims: t.getAnimations({ subtree: true }).map(a => a.animationName), txt: t.textContent, act: !!t.querySelector('[data-memfocus]') }; });
    ok(tag + '⑥ 清空后出现空状态（托盘、文字、下一步入口）' + (reduce ? '' : '，托盘和音符在动'), e1 && e1.play && /记忆是空的/.test(e1.txt) && e1.act && (reduce ? true : e1.anims.indexOf('trayWob') >= 0 && e1.anims.indexOf('noteUp') >= 0), e1);
    await p.waitForTimeout(1100);
    ok(tag + '⑥ 播完静止（没有还在跑的动画）', await p.evaluate(() => document.querySelector('.etray').getAnimations({ subtree: true }).filter(a => a.playState === 'running').length === 0));
    await p.evaluate(() => history.back()); await wait(400); await tap('[data-ui="memory"]'); await wait(600);
    ok(tag + '⑥ 再进来：静态空状态，不再播', await p.evaluate(() => { const t = document.querySelector('.etray'); return !!t && !t.classList.contains('play'); }));
    await tap('[data-memfocus]'); await wait(600);
    ok(tag + '⑥ 下一步入口：光标到「添加」输入框', await p.evaluate(() => document.activeElement && document.activeElement.id === 'mem-add-global'));
    await p.evaluate(() => { document.activeElement.blur(); history.back(); }); await wait(400);

    // ⑥ 笔记回收站清空
    await p.evaluate(() => __goTab('plan')); await wait(600);
    await tap('#main .seg2 button:nth-child(4)'); await wait(700);
    await p.evaluate(() => { const e = document.querySelector('[data-nmenu="open"]'); e && e.click(); }); await wait(500);
    await p.evaluate(() => { const e = document.querySelector('[data-nview="trash"]'); e && e.click(); }); await wait(600);
    await p.evaluate(() => document.querySelector('[data-ntrash="empty"]').click()); await wait(100);
    await p.evaluate(() => document.querySelector('[data-ntrash="empty"]').click()); await p.waitForTimeout(100);
    const e2 = await p.evaluate(() => { const t = document.querySelector('.etray'); return t && { play: t.classList.contains('play'), txt: t.textContent, back: !!t.querySelector('[data-nview=""]') }; });
    ok(tag + '⑥ 回收站清空：托盘空状态 + 回到所有笔记', e2 && e2.play && /最近删除是空的/.test(e2.txt) && e2.back, e2);
    await tap('.etray [data-nview=""]'); await wait(600);

    // ① 清单：圆 → 勾（原地变，不整页重画），进度跟着走；连点从当前形状反向
    await p.evaluate(() => document.querySelector('[data-nopen="nck"]').click()); await wait(800);
    const prog = () => p.evaluate(() => { const e = document.querySelector('.ne-prog'); return e && { t: e.querySelector('b').textContent, p: e.querySelector('i').style.getPropertyValue('--p') }; });
    ok(tag + '① 打开清单笔记：进度 1/4', (await prog()).t === '1/4', await prog());
    await p.evaluate(() => { document.querySelector('.ne-body').__mark = 1; });
    const ck = sel => p.evaluate(s => { const b = document.querySelector(s), pa = b.querySelector('.ck-ic path'), cs = getComputedStyle(pa); return { on: b.querySelector('.ck-ic').classList.contains('on'), y: b.classList.contains('y'), aria: b.getAttribute('aria-checked'), off: parseFloat(cs.strokeDashoffset), arr: cs.strokeDasharray.split(',')[0], u: getComputedStyle(b.querySelector('u')).backgroundSize }; }, sel);
    const A = '[data-ntick="nck:1"]';
    await tap(A); if (!reduce) { await p.waitForTimeout(150); const m1 = await ck(A); ok('① 变形中：露出的那段正沿路径滑向勾（虚线偏移在 0 和 -61 之间）', m1.off < -3 && m1.off > -58, m1); }
    await wait(500); let c1 = await ck(A);
    ok(tag + '① 勾上：对勾、aria-checked、文字划线', c1.on && c1.y && c1.aria === 'true' && Math.abs(c1.off + 61.08) < .5 && /^100%/.test(c1.u), c1);
    ok(tag + '① 进度 2/4，且没有整页重画（读到哪儿不动）', (await prog()).t === '2/4' && await p.evaluate(() => document.querySelector('.ne-body').__mark === 1), await prog());
    if (!reduce) {
      await tap(A); await p.waitForTimeout(120); const mid = await ck(A);
      await tap(A); await p.waitForTimeout(20); const mid2 = await ck(A);
      ok('① 取消到一半又勾上：从当前位置往回走（不跳回起点）', Math.abs(mid2.off - mid.off) < 15 && mid.off > -58, [mid.off, mid2.off]);
      await p.waitForTimeout(600); c1 = await ck(A); ok('① 连点三次后停在「勾上」', c1.on && Math.abs(c1.off + 61.08) < .5, c1);
    }
    await tap(A); await wait(600); c1 = await ck(A);
    ok(tag + '① 再点：逆向回到空心圆，进度 1/4', !c1.on && Math.abs(c1.off) < .5 && c1.arr.trim() === '56.55px' && (await prog()).t === '1/4', c1);
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('cloud-weather-notes-v1')).filter(n => n.id === 'nck')[0].body);
    ok(tag + '① 存进去的正文跟着变', /- \[ \] 牛奶/.test(saved) && /- \[x\] 鸡蛋/.test(saved), saved);
    await p.evaluate(() => history.back()); await wait(500);

    // ② 聊天 ＋ → 叉：＋ 跟着面板的角到左上角变成 ✕；关的时候原路转回
    await p.evaluate(() => __goTab('today')); await wait(500);
    await tap('.dk-in'); await wait(900);
    const plusR = await p.evaluate(() => { const r = document.querySelector('[data-tool="plus"] svg').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await tap('[data-tool="plus"]');
    if (!reduce) {
      await p.waitForTimeout(200);
      const g = await p.evaluate(() => { const g = document.querySelector('.pl-ghost'), x = document.querySelector('.pl-pop .pop-head > button'); return g && { tr: getComputedStyle(g).transform, xh: x.classList.contains('x-hide'), xo: getComputedStyle(x).opacity }; });
      ok('② 展开中：＋ 在转、在移动，面板的 ✕ 先藏着', g && g.tr !== 'none' && g.xh, g);
    }
    await wait(900);
    const g2 = await p.evaluate(() => ({ ghost: !!document.querySelector('.pl-ghost'), xh: document.querySelector('.pl-pop .pop-head > button').classList.contains('x-hide') }));
    ok(tag + '② 展开完：＋ 落成面板左上角的 ✕（替身拿掉，真的 ✕ 显示）', !g2.ghost && !g2.xh, g2);
    if (!reduce) {
      const xr = await p.evaluate(() => { const r = document.querySelector('.pl-pop .pop-head > button svg').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      await p.evaluate(() => history.back()); await p.waitForTimeout(140);
      const gm = await p.evaluate(() => { const g = document.querySelector('.pl-ghost'); if (!g) return null; const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      ok('② 关的时候：✕ 沿原路往 ＋ 回去（在两者之间）', gm && gm[1] > xr[1] + 5 && gm[1] < plusR[1] - 5, [xr, gm, plusR]);
      await p.evaluate(() => document.querySelector('[data-tool="plus"]').click()); await p.waitForTimeout(600);
      ok('② 收到一半再点 ＋：转回 ✕、面板还在', await p.evaluate(() => !!document.querySelector('.pl-pop') && !document.querySelector('.pl-ghost') && !document.querySelector('.pl-pop .pop-head > button').classList.contains('x-hide')));
    }
    await p.evaluate(() => history.back()); await wait(700);
    ok(tag + '② 关完：面板没了，＋ 回到原位', await p.evaluate(() => !document.querySelector('.pl-pop') && !!document.querySelector('[data-tool="plus"]')));
    ok(tag + '无页面错误', errs.length === 0, errs);
    await ctx.close();
  }

  // ③ 音频播放键：单独测 audioBind（从 index.html 里取出来），用真的 <audio>：成功 / 加载失败 / 重试
  {
    const html = fs.readFileSync('apk/www/index.html', 'utf8');
    const fn = html.slice(html.indexOf('  function audioBind('), html.indexOf('\n  }\n', html.indexOf('  function audioBind(')) + 4);
    const css = html.slice(html.indexOf('/* ===================== 5.15 图标微动效'), html.indexOf('</style>', html.indexOf('/* ===================== 5.15 图标微动效')));
    const ctx = await b.newContext({ viewport: { width: 412, height: 400 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.setContent('<style>:root{--ink:#222;--surface:#fff;--muted:#888}' + css + '</style><div class="fv-audio"><audio id="fv-media" preload="metadata"></audio><div class="ap" id="fv-ap" data-st="idle"><button type="button" class="ap-b" aria-label="播放"><svg class="ldr"></svg><svg class="ap-pp" width="24" height="24" viewBox="0 0 24 24"><path class="a"/><path class="b"/></svg></button><div class="ap-tl"><input type="range" min="0" max="1000" value="0"><span class="ap-t"></span></div></div><p class="ap-msg"></p></div>');
    await p.addScriptTag({ content: fn + '\nwindow.audioBind = audioBind;' });
    // 1 秒的静音 WAV
    await p.evaluate(() => { const sr = 8000, n = sr, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }; w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true); window.__wav = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })); });
    await p.evaluate(() => { window.__bad = true; audioBind(document.getElementById('fv-media'), () => window.__bad ? Promise.reject({ msg: '找不到文件' }) : Promise.resolve(window.__wav)); });
    const st = () => p.evaluate(() => ({ st: document.getElementById('fv-ap').getAttribute('data-st'), on: document.querySelector('.ap-pp').classList.contains('on'), msg: document.querySelector('.ap-msg').textContent, label: document.querySelector('.ap-b').getAttribute('aria-label') }));
    await p.click('.ap-b'); await p.waitForTimeout(300);
    let s = await st(); ok('③ 加载失败：回到播放键，写清原因，提示再试', s.st === 'err' && !s.on && /找不到文件/.test(s.msg) && /再试/.test(s.msg), s);
    await p.evaluate(() => { window.__bad = false; }); await p.click('.ap-b'); await p.waitForTimeout(30);
    s = await st(); ok('③ 重试：点了马上变成暂停形状（缓冲时转圈）', (s.st === 'load' || s.st === 'play') && s.on, s);
    await p.waitForTimeout(500); s = await st(); ok('③ 真的在播：暂停键、无报错文字', s.st === 'play' && s.on && !s.msg && s.label === '暂停', s);
    await p.click('.ap-b'); await p.waitForTimeout(100); s = await st();
    ok('③ 点暂停：变回播放三角，音频真的停了', s.st === 'idle' && !s.on && await p.evaluate(() => document.getElementById('fv-media').paused), s);
    await p.click('.ap-b'); await p.waitForTimeout(1500); s = await st();
    ok('③ 放完：回到播放键、进度归零', s.st === 'idle' && !s.on && await p.evaluate(() => document.getElementById('fv-media').currentTime === 0), s);
    await p.evaluate(() => { const a = document.getElementById('fv-media'); a.src = URL.createObjectURL(new Blob(['not really audio, just text'], { type: 'audio/wav' })); }); await p.waitForTimeout(400); s = await st();
    ok('③ 文件坏了 / 格式不支持：马上报错（不用等点播放）', s.st === 'err' && !s.on && /格式/.test(s.msg) && /再试/.test(s.msg), s);
    await p.click('.ap-b'); await p.waitForTimeout(600); s = await st();
    ok('③ 再点：重新取文件，能播了', s.st === 'play' && s.on && !s.msg, s);
    ok('③ 无页面错误', errs.length === 0, errs);
    await ctx.close();
  }
  await b.close();
  console.log((fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + pass);
  process.exit(fail ? 1 : 0);
})();
