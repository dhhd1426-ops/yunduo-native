// 5.14 交互动效测试：10 种动效的终态 + 中途打断 / 反向 / 快速连点 / 失败重试 / 减少动态效果
// VP='[412,915]' node tests/motion514test.js   （SHOT=1 存关键帧截图到 shots/m514）
const { chromium } = require('playwright');
const fs = require('fs');
const VP = JSON.parse(process.env.VP || '[412,915]'), OUT = 'shots/m514';
fs.mkdirSync(OUT, { recursive: true });
const docs = {}; fs.readdirSync('cma/docs').filter(f => !f.startsWith('_')).forEach(f => { const d = JSON.parse(fs.readFileSync('cma/docs/' + f, 'utf8')); docs[d.fid] = d; docs['n' + d.nid] = d; });
let pass = 0, fail = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 240) : '')); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] });
  const run = async (reduce) => {
    const ctx = await b.newContext({ viewport: { width: VP[0], height: VP[1] }, hasTouch: true, isMobile: VP[0] < 700, timezoneId: 'Asia/Shanghai', reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    let chatFail = true, chatCalls = 0;
    await p.route(/^https:\/\//, async route => {
      const u = new URL(route.request().url()), H = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }; let m;
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
      if (u.host === 'weather.cma.cn' && (m = u.pathname.match(/\/api\/now\/(.+)$/))) return route.fulfill({ headers: H, body: JSON.stringify({ code: 0, data: { location: { id: decodeURIComponent(m[1]) }, now: { temperature: 21, feelst: 20, humidity: 55, precipitation: 0, pressure: 1008, windDirection: '东北风', windScale: '2级', windSpeed: 2 }, alarm: [], lastUpdate: '2026/10/02 10:00' } }) });
      if (u.host === 'weather.cma.cn' && (m = u.pathname.match(/\/api\/weather\/(.+)$/))) { const id = decodeURIComponent(m[1]), d = docs[id] || docs['58457']; return route.fulfill({ headers: H, body: JSON.stringify({ code: 0, data: { location: { id }, daily: d.daily.map((x, i) => { const t = new Date(Date.now() + 8 * 3600e3 + i * 864e5), pd = n => String(n).padStart(2, '0'); return { date: t.getUTCFullYear() + '/' + pd(t.getUTCMonth() + 1) + '/' + pd(t.getUTCDate()), dayText: x.dt || '晴', nightText: x.nt || '多云', high: x.hi, low: x.lo, dayWindDirection: x.wd, dayWindScale: x.ws }; }), alarm: [], lastUpdate: '2026/10/02 08:00' } }) }); }
      if (u.host === 'api.deepseek.com' && u.pathname.endsWith('/chat/completions')) { chatCalls++; await new Promise(r => setTimeout(r, 900)); if (chatFail) return route.fulfill({ status: 401, headers: H, body: '{"error":{"message":"Authentication Fails"}}' }); return route.fulfill({ headers: H, body: JSON.stringify({ model: 'deepseek-chat', choices: [{ message: { content: '连接成功' } }] }) }); }
      if (u.host === 'api.deepseek.com') return route.fulfill({ headers: H, body: '{"data":[{"id":"deepseek-chat"}]}' });
      return route.fulfill({ status: 404, body: '' });
    });
    await p.addInitScript(() => {
      window.__rainForce = false;
      if (localStorage.getItem('seed')) return; localStorage.setItem('seed', '1');
      localStorage.setItem('cloud-weather-app-v2', JSON.stringify({ cities: ['hz', 'sh'], current: 'hz', name: '小宇', tab: 'today', splashMode: 'off' }));
      localStorage.setItem('cloud-weather-walls-v1', JSON.stringify({ list: [], cur: '', dyn: false, fps: 30, depth: true }));
      localStorage.setItem('cloud-weather-deepseek', JSON.stringify({ key: 'sk-x', base: 'https://api.deepseek.com/v1', path: '/chat/completions', enabled: true, model: 'deepseek-chat', models: ['deepseek-chat'], available: [] }));
      const T = Date.now(), notes = []; for (let i = 0; i < 9; i++) notes.push({ id: 'n' + i, title: '笔记 ' + i, body: '第一行\n- [ ] 事项 ' + i + '\n第三行', tags: [], folder: '', pin: i === 0, paper: ['plain', 'warm', 'blue'][i % 3], date: '', created: T - i * 864e5, updated: T - i * 864e5 });
      localStorage.setItem('cloud-weather-notes-v1', JSON.stringify(notes));
      localStorage.setItem('cloud-weather-calendar-v1', JSON.stringify({ events: [], alarms: [{ id: 7, h: 7, m: 30, days: [1, 2, 3, 4, 5], date: '', on: true, label: '上班', snooze: 10, ramp: true, amor: true }] }));
    });
    await p.goto('file://' + process.cwd() + '/apk/www/index.html');
    await p.waitForFunction(() => document.querySelector('#wall.ready'), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(1500);   // 等壁纸就绪（软件渲染编着色器时画面帧会卡住，动画计时不走）
    const tag = reduce ? '[减少动态] ' : '';
    const shot = n => process.env.SHOT && !reduce ? p.screenshot({ path: `${OUT}/${n}.png` }) : null;
    const nav = () => p.evaluate(() => history.state && history.state.nav);

    // ⑩ ④ 三条杠 → 圆形铺满 → 设置；✕ 收回
    await p.click('.w-menu');
    if (!reduce) { await p.waitForTimeout(200); const mid = await p.evaluate(() => { const c = document.querySelector('.circ'); return c && { x: c.querySelector('.mx').classList.contains('x'), clip: getComputedStyle(c.querySelector('.circ-bg')).clipPath }; }); ok('圆形铺开中：叉号已合成、在用 circle 裁切', mid && mid.x && /circle/.test(mid.clip), mid); await shot('10-circ-mid'); }
    await p.waitForFunction(() => !document.querySelector('.circ'), null, { timeout: 4000 }).catch(() => {});   // 软件渲染偶尔卡帧，遮罩淡出要等画面恢复
    const st1 = await p.evaluate(() => ({ tab: JSON.parse(localStorage.getItem('cloud-weather-app-v2')).tab, ov: !!document.querySelector('.circ'), oa: document.querySelector('.circ-bg') ? document.querySelector('.circ-bg').getAnimations().map(a => a.playState + ':' + Math.round(a.currentTime)) : null, x: !!document.querySelector('.set-x .mx.x'), top: getComputedStyle(document.querySelector('.top')).display }));
    ok(tag + '铺满后进了设置，遮罩拿掉，右上角是 ✕，顶栏隐藏', st1.tab === 'settings' && !st1.ov && st1.x && st1.top === 'none', st1);
    const xr = await p.evaluate(() => { const r = document.querySelector('.set-x').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
    await p.evaluate(() => history.back()); await p.waitForTimeout(700); await p.waitForFunction(() => !document.querySelector('.circ'), null, { timeout: 4000 }).catch(() => {});
    const st2 = await p.evaluate(() => ({ tab: JSON.parse(localStorage.getItem('cloud-weather-app-v2')).tab, ov: !!document.querySelector('.circ'), m: document.querySelector('.w-menu') && (r => [Math.round(r.left), Math.round(r.top)])(document.querySelector('.w-menu').getBoundingClientRect()) }));
    ok(tag + '返回手势：收回首页，遮罩拿掉', st2.tab === 'today' && !st2.ov, st2);
    ok(tag + '✕ 和三条杠在同一个位置', st2.m && Math.abs(st2.m[0] - xr[0]) <= 1 && Math.abs(st2.m[1] - xr[1]) <= 1, [xr, st2.m]);
    if (!reduce) {   // 铺到一半按返回：从当前半径往回收，不进设置
      await p.click('.w-menu'); await p.waitForTimeout(180); await p.evaluate(() => history.back()); await p.waitForTimeout(900);
      const st3 = await p.evaluate(() => ({ tab: JSON.parse(localStorage.getItem('cloud-weather-app-v2')).tab, ov: !!document.querySelector('.circ') }));
      ok('铺到一半按返回：收回、还在首页', st3.tab === 'today' && !st3.ov, st3);
      // 快速连点三条杠
      await p.evaluate(() => { const b = document.querySelector('.w-menu'); b.click(); b.click(); b.click(); }); await p.waitForTimeout(1200);
      const st4 = await p.evaluate(() => ({ tab: JSON.parse(localStorage.getItem('cloud-weather-app-v2')).tab, n: document.querySelectorAll('.circ').length, nav: history.state && history.state.nav }));
      ok('快速连点三次：只开一次，进设置，没有残留遮罩', st4.tab === 'settings' && st4.n === 0, st4);
      await p.click('.set-x'); await p.waitForTimeout(1100);
      ok('点 ✕ 收回首页', await p.evaluate(() => JSON.parse(localStorage.getItem('cloud-weather-app-v2')).tab) === 'today');
    }

    // ⑤ 分段标签：选中块滑过去，终点贴合按钮；连点时从当前位置转向
    await p.evaluate(() => __goTab('plan')); await p.waitForTimeout(900);
    const segOk = async () => p.evaluate(() => { const s = document.querySelector('#main .seg2'), d = s.querySelector('.seg-ind'), bt = s.querySelector('button[aria-pressed="true"]'); if (!d) return null; const a = d.getBoundingClientRect(), c = bt.getBoundingClientRect(); return { dl: Math.round(a.left - c.left), dw: Math.round(a.width - c.width), txt: bt.textContent }; });
    await p.click('#main .seg2 button:nth-child(3)'); if (!reduce) { await p.waitForTimeout(140); const mid = await p.evaluate(() => { const d = document.querySelector('#main .seg2 .seg-ind'); return d && d.getAnimations().length; }); ok('标签切换：选中块在动', mid > 0, mid); }
    await p.waitForTimeout(700); let so = await segOk();
    ok(tag + '标签切到「闹钟」：选中块贴合目标', so && so.txt === '闹钟' && Math.abs(so.dl) <= 1 && Math.abs(so.dw) <= 1, so);
    if (!reduce) {
      const relL = () => p.evaluate(() => { const s = document.querySelector('#main .seg2'); return Math.round(s.querySelector('.seg-ind').getBoundingClientRect().left - s.getBoundingClientRect().left); });
      await p.click('#main .seg2 button:nth-child(2)'); await p.waitForTimeout(700);   // 先回到日历
      await p.click('#main .seg2 button:nth-child(3)'); await p.waitForTimeout(110);   // 去闹钟，走到一半
      const midL = await relL();
      await p.click('#main .seg2 button:nth-child(2)'); await p.waitForTimeout(16);    // 立刻改回日历
      const startL = await relL();
      ok('连点：转向时从当前位置出发（不跳回起点）', Math.abs(startL - midL) < 40, [midL, startL]);
      await p.waitForTimeout(700); so = await segOk(); ok('连点后停在最后点的「日历」', so && so.txt === '日历' && Math.abs(so.dl) <= 1, so);
    }

    // ⑥ 闹钟步进器：＋ → − 数量 ＋，数字竖滚，减到 0 收回
    await p.click('#main .seg2 button:nth-child(3)'); await p.waitForTimeout(700);
    await p.evaluate(() => { const r = Array.from(document.querySelectorAll('#main button')).find(b => /07:30/.test(b.textContent)); r && r.click(); }); await p.waitForTimeout(700);
    const hasStp = await p.$('[data-stp="snooze"]');
    if (!hasStp) { const t = await p.evaluate(() => Array.from(document.querySelectorAll('#main button')).map(b => Object.keys(b.dataset).join('/') + ':' + b.textContent.slice(0, 8)).slice(0, 30)); console.log('alarm buttons', JSON.stringify(t)); }
    ok(tag + '闹钟编辑页有步进器（10 分钟）', !!hasStp && await p.evaluate(() => document.querySelector('[data-stp="snooze"] .stp-v b').textContent) === '10');
    if (hasStp) {
      await p.click('[data-snz="5"]'); if (!reduce) { await p.waitForTimeout(80); ok('加：数字在竖向滚动（两个数字叠着）', (await p.evaluate(() => document.querySelectorAll('[data-stp="snooze"] .stp-v b').length)) === 2); }
      await p.waitForTimeout(400);
      ok(tag + '加 5 → 15', await p.evaluate(() => document.querySelector('[data-stp="snooze"] .stp-v b:last-child').textContent) === '15');
      for (let i = 0; i < 3; i++) { await p.click('[data-snz="-5"]'); await p.waitForTimeout(120); }
      await p.waitForTimeout(600);
      const z = await p.evaluate(() => { const s = document.querySelector('[data-stp="snooze"]'); return { on: s.classList.contains('on'), w: Math.round(s.getBoundingClientRect().width), off: !document.querySelector('.stp-off').hidden }; });
      ok(tag + '减到 0：收回成圆形 ＋，显示「不能再睡」', !z.on && z.w <= 42 && z.off, z);
      await p.click('[data-snz="5"]'); await p.waitForTimeout(600);
      const z2 = await p.evaluate(() => { const s = document.querySelector('[data-stp="snooze"]'); return { on: s.classList.contains('on'), w: Math.round(s.getBoundingClientRect().width), v: s.querySelector('.stp-v b').textContent }; });
      ok(tag + '再点 ＋：展开成胶囊，5 分钟', z2.on && z2.w >= 140 && z2.v === '5', z2);
      await p.evaluate(() => history.back()); await p.waitForTimeout(600);
    }

    // ①⑨ 笔记：大搜索栏随滚动收成搜索键；点开横向展开成输入框；关闭收回、列表和滚动位置保留
    await p.evaluate(() => __goTab('plan')); await p.waitForTimeout(400);
    await p.click('#main .seg2 button:nth-child(4)').catch(() => {}); await p.waitForTimeout(900);
    const geo = () => p.evaluate(() => { const s = document.querySelector('#main .nb-sx'); if (!s) return null; const r = s.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), open: s.classList.contains('open') }; });
    const g0 = await geo(); ok(tag + '笔记首页：顶上是宽搜索栏', g0 && g0.w > 300, g0); await shot('09-wide');
    await p.evaluate(() => { document.getElementById('main').scrollTop = 400; }); await p.waitForTimeout(300);
    const g1 = await geo(); ok(tag + '往下滚：收成右上角 44×44 搜索键', g1 && g1.w === 44 && g1.h === 44, g1); await shot('09-icon');
    await p.evaluate(() => { const h = document.querySelector('#main .nb-hero').offsetHeight; document.getElementById('main').scrollTop = h - 75; }); await p.waitForTimeout(300);
    const g15 = await geo(); ok(tag + '滚到中间：宽度在两者之间（跟着滚动连续变）', g15 && g15.w > 44 && g15.w < g0.w, g15);
    await p.evaluate(() => { document.getElementById('main').scrollTop = 400; }); await p.waitForTimeout(300);
    const y0 = await p.evaluate(() => document.getElementById('main').scrollTop);
    const tap = async sel => { const r = await p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }); await p.touchscreen.tap(r[0], r[1]); };   // 真实点按（p.click 会先把吸顶栏里的按钮「滚进视野」）
    console.log('hit at', JSON.stringify(await p.$eval('#main .nb-sx-hit', e => { const b = e.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, t = document.elementFromPoint(x, y); return [Math.round(x), Math.round(y), t && t.className]; })));
    await tap('#main .nb-sx-hit'); await p.waitForTimeout(reduce ? 200 : 450);
    const g2 = await geo(); ok(tag + '点搜索键：横向展开成输入框，焦点在输入框', g2 && g2.open && g2.w > 250 && await p.evaluate(() => document.activeElement && document.activeElement.id === 'note-q'), g2); await shot('01-open');
    await p.fill('#note-q', '笔记 3'); await p.waitForTimeout(400);
    ok(tag + '输入搜索：列表只剩 1 条，输入框还开着', (await p.evaluate(() => document.querySelectorAll('#main .nb-row').length)) === 1 && (await geo()).open);
    await tap('.nb-sx-x'); await p.waitForTimeout(400);
    ok(tag + '× 先清空搜索词（列表恢复、还在搜索）', (await p.evaluate(() => document.querySelectorAll('#main .nb-row').length)) === 9 && (await geo()).open);
    console.log('before back', JSON.stringify(await p.evaluate(() => ({ nav: history.state && history.state.nav, y: document.getElementById('main').scrollTop }))));
    await p.evaluate(() => history.back()); await p.waitForTimeout(600);
    console.log('after back', JSON.stringify(await p.evaluate(() => ({ nav: history.state && history.state.nav, y: document.getElementById('main').scrollTop, tab: JSON.parse(localStorage.getItem('cloud-weather-app-v2')).tab }))));
    const g3 = await geo(); ok(tag + '返回手势：收回成搜索键', g3 && !g3.open && g3.w === 44, g3);
    ok(tag + '收回后滚动位置不变', Math.abs((await p.evaluate(() => document.getElementById('main').scrollTop)) - y0) < 4);
    if (!reduce) {   // 快速连点：开 → 关 → 开
      await p.evaluate(() => { const h = document.querySelector('#main .nb-sx-hit'); h.click(); }); await p.waitForTimeout(100);
      await p.evaluate(() => history.back()); await p.waitForTimeout(80);
      await p.evaluate(() => { const h = document.querySelector('#main .nb-sx-hit'); h.click(); }); await p.waitForTimeout(500);
      const g4 = await geo(); ok('开 → 关 → 开连着点：最后是展开的', g4 && g4.open && g4.w > 250, g4);
      await p.evaluate(() => history.back()); await p.waitForTimeout(500);
    }

    // ⑧ 列表 ⇄ 网格（FLIP）
    await p.evaluate(() => { document.getElementById('main').scrollTop = 300; }); await p.waitForTimeout(200);
    const before = await p.evaluate(() => Array.from(document.querySelectorAll('#main [data-flip]')).map(e => e.getAttribute('data-flip')).join());
    await p.click('[data-nlmore]'); await p.waitForTimeout(300); await p.click('[data-nlayout="grid"]');
    if (!reduce) { await p.waitForTimeout(120); const a = await p.evaluate(() => document.querySelector('#main .nb-rows.grid [data-flip]').getAnimations().length); ok('切网格：卡片从旧位置动过去（FLIP 动画在跑）', a > 0, a); await shot('08-mid'); }
    await p.waitForTimeout(1300);
    const gr = await p.evaluate(() => ({ grid: !!document.querySelector('#main .nb-rows.grid'), ids: Array.from(document.querySelectorAll('#main [data-flip]')).map(e => e.getAttribute('data-flip')).join(), anim: document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('[data-flip]')).length, saved: localStorage.getItem('cloud-weather-notes-layout') }));
    ok(tag + '网格：同一批卡片、动画播完、记住了', gr.grid && gr.ids === before && gr.anim === 0 && gr.saved === 'grid', gr); await shot('08-grid');
    const th = await p.evaluate(() => { const t = document.querySelector('#main .nb-rows.grid .nb-th').getBoundingClientRect(); return { w: Math.round(t.width), h: Math.round(t.height) }; });
    ok(tag + '网格缩略图变大（保持裁切，不是拉伸）', th.w > 100 && th.h === 112, th);
    await p.click('[data-nlmore]'); await p.waitForTimeout(300); await p.click('[data-nlayout="list"]'); await p.waitForTimeout(1300);
    ok(tag + '切回列表', await p.evaluate(() => !document.querySelector('#main .nb-rows.grid') && document.querySelectorAll('#main .nb-row').length === 9));

    // ⑦ 天气：未来 7 天原地展开、收起，不整页重画
    await p.evaluate(() => __goTab('forecast')); await p.waitForTimeout(900);
    if (!(await p.$('#main .day[data-day="2"]'))) console.log('days:', await p.evaluate(() => [document.querySelectorAll('#main .day').length, document.querySelector('#main .view') && document.querySelector('#main .view').className, JSON.parse(localStorage.getItem('cloud-weather-app-v2')).tab]));
    await p.evaluate(() => document.querySelector('#main .day[data-day="2"]').scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    const mark = await p.evaluate(() => { const v = document.querySelector('#main .view'); v.__mark = 1; return Math.round(document.querySelector('#main .day[data-day="2"]').getBoundingClientRect().top); });
    const below0 = await p.evaluate(() => Math.round(document.querySelector('#main .day[data-day="3"]').getBoundingClientRect().top));
    await p.click('#main .day[data-day="2"]');
    if (!reduce) { await p.waitForTimeout(50); const h = await p.evaluate(() => Math.round(document.querySelector('#main .day[data-day="2"]').parentNode.querySelector('.day-more').getBoundingClientRect().height)); ok('展开中：详情高度在长', h >= 0 && h < 100, h); }
    await p.waitForTimeout(600);
    const dx = await p.evaluate(() => { const w = document.querySelector('#main .day[data-day="2"]').parentNode, m = w.querySelector('.day-more'); return { same: document.querySelector('#main .view').__mark === 1, h: m && Math.round(m.getBoundingClientRect().height), top: Math.round(w.querySelector('.day').getBoundingClientRect().top), below: Math.round(document.querySelector('#main .day[data-day="3"]').getBoundingClientRect().top), exp: w.querySelector('.day').getAttribute('aria-expanded') }; });
    ok(tag + '原地展开：' + (reduce ? '' : '没有整页重画、') + '这一行不动、下面的行让开', (dx.same || reduce) && dx.h > 60 && Math.abs(dx.top - mark) <= 1 && dx.below > below0 + 50 && dx.exp === 'true', dx);
    await p.click('#main .day[data-day="4"]'); await p.waitForTimeout(700);
    const dx2 = await p.evaluate(() => ({ n: document.querySelectorAll('#main .day-more').length, open: document.querySelector('#main .day[data-day="4"]').getAttribute('aria-expanded') }));
    ok(tag + '点另一天：前一个收起、这个展开（只开一个）', dx2.n === 1 && dx2.open === 'true', dx2);
    if (!reduce) { await p.click('#main .day[data-day="4"]'); await p.waitForTimeout(120); await p.click('#main .day[data-day="4"]'); await p.waitForTimeout(700);
      ok('收到一半又点开：接着展开', await p.evaluate(() => { const m = document.querySelector('#main .day[data-day="4"]').parentNode.querySelector('.day-more'); return !!m && m.getBoundingClientRect().height > 60 && !m.classList.contains('closing'); })); }
    await p.click('#main .day[data-day="4"]'); await p.waitForTimeout(600);
    ok(tag + '再点收起', await p.evaluate(() => document.querySelectorAll('#main .day-more').length === 0));

    // ③ 测试连接：加载圈 → 失败（叉 + 重试）→ 成功（勾 + 结果条）；加载中不能重复提交
    await p.evaluate(() => __goTab('settings')); await p.waitForTimeout(500);
    await p.evaluate(() => { const b = document.querySelector('[data-ui="providers"]'); b && b.click(); }); await p.waitForTimeout(500);
    await p.evaluate(() => { const b = document.querySelector('[data-openprov="deepseek"]'); b && b.click(); }); await p.waitForTimeout(500);
    const mb = async () => p.evaluate(() => { const b = document.querySelector('.mb[data-mb="ptest"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { st: b.dataset.st, w: Math.round(r.width), cx: Math.round(r.left + r.width / 2), dis: b.disabled }; });
    // 5.16.1 测试连接按钮换成 ApiMo.test（api516test 覆盖）
    ok(tag + '供应商页有「测试连接」长按钮（5.16.1 组件）', await p.evaluate(() => { const b = document.querySelector('.ap-test'); return !!b && b.getBoundingClientRect().width > 200; }));
    const m0 = null;
    if (m0) {
      await p.click('.mb[data-mb="ptest"]'); await p.waitForTimeout(reduce ? 100 : 450);
      const m1 = await mb(); ok(tag + '点了：收成圆形加载器，按钮禁用', m1.st === 'load' && m1.w === 48 && m1.dis, m1); await shot('03-load');
      ok(tag + '加载中容器中心不动', Math.abs(m1.cx - m0.cx) <= 1, [m0.cx, m1.cx]);
      await p.evaluate(() => { const b = document.querySelector('.mb[data-mb="ptest"]'); b.click(); b.click(); });
      await p.waitForTimeout(1600);
      const m2 = await mb(); ok(tag + '失败：结果条 + 可重试，只请求了 1 次', m2.st === 'err' && m2.w > 200 && chatCalls === 1, [m2, chatCalls]); await shot('03-err');
      chatFail = false; await p.click('.mb[data-mb="ptest"]'); await p.waitForTimeout(2200);
      const m3 = await mb(); ok(tag + '重试成功：勾 → 结果条', m3.st === 'ok' && m3.w > 200 && chatCalls === 2, [m3, chatCalls]); await shot('03-ok');
      ok(tag + '详细结果还在下面', await p.evaluate(() => /连接成功/.test((document.querySelector('.ds-status.ok') || {}).textContent || '')));
      await p.evaluate(() => history.back()); await p.waitForTimeout(400); await p.evaluate(() => history.back()); await p.waitForTimeout(400);
    }

    // ② ＋ 面板：从 ＋ 长出来；关时收回；收到一半再点 ＋ 长回去
    await p.evaluate(() => __goTab('today')); await p.waitForTimeout(500);
    await p.click('.dk-in'); await p.waitForTimeout(900);
    await p.click('[data-tool="plus"]');
    if (!reduce) { await p.waitForTimeout(150); const c = await p.evaluate(() => { const pp = document.querySelector('.pl-pop'); return pp && pp.getAnimations().some(a => a.effect.getKeyframes().some(k => k.clipPath)); }); ok('＋ 面板从按钮的位置裁切长出来', c); await shot('02-mid'); }
    await p.waitForTimeout(1100);
    ok(tag + '面板打开，选项都显示', await p.evaluate(() => { const pp = document.querySelector('.pl-pop'); return !!pp && Array.from(pp.querySelectorAll('.pl-card')).every(c => getComputedStyle(c).opacity === '1'); }));
    await p.evaluate(() => history.back()); await p.waitForTimeout(reduce ? 400 : 160);
    if (!reduce) { await p.evaluate(() => document.querySelector('[data-tool="plus"]').click()); await p.waitForTimeout(500); ok('收到一半再点 ＋：长回去、面板还在', await p.evaluate(() => !!document.querySelector('.pl-pop') && history.state && history.state.nav >= 2)); await p.evaluate(() => history.back()); }
    await p.waitForTimeout(700);
    ok(tag + '关掉后面板没了，聊天还在', await p.evaluate(() => !document.querySelector('.pl-pop') && !!document.querySelector('.sheet-wrap')));
    await p.evaluate(() => history.back()); await p.waitForTimeout(600);

    ok(tag + '无页面错误', errs.length === 0, errs);
    await ctx.close();
  };
  await run(false);
  await run(true);
  console.log(fail ? fail + ' FAIL' : 'ALL PASS ' + pass);
  await b.close();
})();
