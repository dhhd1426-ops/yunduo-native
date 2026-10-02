// 5.11 沉浸式翻页：没有导航岛；首页右划 → 天气、左划 → 日程；反向划回；返回手势回首页；右上角三条杠 → 设置
const { chromium } = require('playwright');
const fs = require('fs');
const VP = JSON.parse(process.env.VP || '[412,915]'), OUT = 'shots/pager';
fs.mkdirSync(OUT, { recursive: true });
const docs = {}; fs.readdirSync('cma/docs').filter(f => !f.startsWith('_')).forEach(f => { const d = JSON.parse(fs.readFileSync('cma/docs/' + f, 'utf8')); docs[d.fid] = d; docs['n' + d.nid] = d; });
let pass = 0, fail = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 200) : '')); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: VP[0], height: VP[1] }, deviceScaleFactor: 1, colorScheme: 'dark', hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const J = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
  await p.route(/^https:\/\//, async route => {
    const u = new URL(route.request().url()); let m;
    if (u.host === 'weather.cma.cn' && (m = u.pathname.match(/\/api\/now\/(.+)$/))) return route.fulfill({ headers: J, body: JSON.stringify({ code: 0, msg: 'success', data: { location: { id: m[1] }, now: { temperature: 21, feelst: 20, humidity: 40, precipitation: 0, pressure: 1012, windDirection: '北风', windScale: '微风', windSpeed: 1 }, alarm: [], lastUpdate: '2026/10/01 13:00' } }) });
    if (u.host === 'weather.cma.cn' && (m = u.pathname.match(/\/api\/weather\/(.+)$/))) { const d = docs[decodeURIComponent(m[1])] || docs['58457'];
      return route.fulfill({ headers: J, body: JSON.stringify({ code: 0, msg: 'success', data: { location: { id: m[1] }, daily: d.daily.map(x => ({ date: x.d, dayText: x.dt || '晴', nightText: x.nt || '晴', high: x.hi, low: x.lo, dayWindDirection: x.wd, dayWindScale: x.ws })), alarm: [], lastUpdate: '2026/10/01 08:00' } }) }); }
    return route.fulfill({ status: 404, body: '' });
  });
  await p.addInitScript(() => { if (window.top !== window) return; try { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('cloud-weather-app-v2', JSON.stringify({ cities: ['bj', 'sh'], current: 'bj', name: '小宇', tab: 'today', splashMode: 'off' })); } } catch (e) {} });
  await p.goto('file://' + process.cwd() + '/apk/www/index.html');
  await p.waitForFunction(() => document.querySelector('#wall.ready'), null, { timeout: 120000 }); await p.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(p);
  async function swipe(x0, y, dx, steps = 12) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / steps, y: y + i * .3 }] }); if (steps > 2) await p.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(900);
  }
  const tab = () => p.evaluate(() => JSON.parse(localStorage.getItem('cloud-weather-app-v2')).tab);
  ok('导航岛不见了', await p.evaluate(() => getComputedStyle(document.getElementById('tabs')).display === 'none'));
  ok('首页右上角有三条杠', await p.isVisible('.w-menu'));
  await p.screenshot({ path: `${OUT}/1-home.png` });
  await swipe(100, 520, 220); ok('首页往右划 → 天气', await tab() === 'forecast', await tab());
  await p.screenshot({ path: `${OUT}/2-weather.png` });
  await swipe(320, 600, -220); ok('天气页往左划 → 回首页', await tab() === 'today', await tab());
  await swipe(320, 520, -220); ok('首页往左划 → 日程', await tab() === 'plan', await tab());
  await p.screenshot({ path: `${OUT}/3-plan.png` });
  await swipe(320, 600, -220); ok('日程页继续往左划 → 天气（循环）', await tab() === 'forecast', await tab());
  await swipe(320, 600, -220); ok('天气页继续往左划 → 首页（循环）', await tab() === 'today', await tab());
  await swipe(100, 520, 220); await swipe(100, 600, 220); ok('天气页继续往右划 → 日程（循环）', await tab() === 'plan', await tab());
  await swipe(100, 600, 220); ok('日程页继续往右划 → 首页（循环）', await tab() === 'today', await tab());
  await swipe(320, 520, -220); await swipe(100, 600, 220); ok('日程页往右划 → 回首页', await tab() === 'today', await tab());
  await swipe(100, 520, 40); ok('划得太短：弹回，还在首页', await tab() === 'today');
  // 返回手势
  await swipe(320, 520, -220); await p.evaluate(() => history.back()); await p.waitForTimeout(900);
  ok('日程页返回手势 → 首页', await tab() === 'today', await tab());
  // 天气页上面大温度那块左右划是换地点
  await swipe(100, 520, 220); await p.waitForTimeout(400);
  const cur0 = await p.evaluate(() => JSON.parse(localStorage.getItem('cloud-weather-app-v2')).current);
  const box = await p.$eval('.wx-top', el => { const r = el.getBoundingClientRect(); return [r.top, r.height]; });
  await swipe(320, box[0] + box[1] * .6, -200, 2); await p.waitForTimeout(800);
  const cur1 = await p.evaluate(() => JSON.parse(localStorage.getItem('cloud-weather-app-v2')).current);
  ok('天气页大温度那块左划 = 换地点（不翻页）', await tab() === 'forecast' && cur0 !== cur1, [cur0, cur1]);
  await p.evaluate(() => history.back()); await p.waitForTimeout(900);
  // 三条杠 → 设置；设置里没有纸纹、启动动画在「主题」里
  await p.click('.w-menu'); await p.waitForFunction(() => JSON.parse(localStorage.getItem('cloud-weather-app-v2')).tab === 'settings' && !document.querySelector('.circ'), null, { timeout: 5000 }).catch(() => {});   // 5.14 圆形铺满约 0.7 秒
  ok('三条杠 → 设置', await tab() === 'settings');
  await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/4-settings.png` }); console.log('dbg', await p.evaluate(() => [document.body.className, document.querySelector('#main .view') && document.querySelector('#main .view').className, getComputedStyle(document.querySelector('#main .view')).opacity, document.querySelector('#main .view').style.cssText]));
  ok('设置页有返回键', await p.isVisible('[data-ui="back-home"]'));
  await p.evaluate(() => history.back()); await p.waitForTimeout(900);
  ok('设置页返回手势 → 首页', await tab() === 'today', await tab());
  // 5.11.1 关聊天后壁纸接着动；磨砂玻璃时聊天窗后面的壁纸在动
  const running = () => p.evaluate(() => __Wall.state().running);
  await p.click('.dk-in'); await p.waitForTimeout(1200);
  ok('简洁：聊天时壁纸停帧', !(await running()));
  await p.evaluate(() => history.back()); await p.waitForTimeout(1500);
  ok('关掉聊天回首页：壁纸马上又动起来', await running());
  await p.evaluate(() => { const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1')); w.ui = 'glass'; localStorage.setItem('cloud-weather-walls-v1', JSON.stringify(w)); });
  await p.reload(); await p.waitForFunction(() => document.querySelector('#wall.ready'), null, { timeout: 120000 }); await p.waitForTimeout(1500);
  await p.click('.dk-in'); await p.waitForTimeout(1500);
  const gl = await p.evaluate(() => { const g = document.querySelector('#wall .wl-glass'); return { cls: document.body.classList.contains('glass-ui'), shared: g.classList.contains('on') && /path\(/.test(g.style.clipPath), bf: getComputedStyle(document.querySelector('.chat-main')).backdropFilter, run: __Wall.state().running }; });
  ok('磨砂玻璃：聊天窗半透明 + 共用模糊图露在玻璃下面（不再 backdrop-filter），后面的壁纸在动', gl.cls && gl.shared && gl.bf === 'none' && gl.run, gl);
  await p.screenshot({ path: `${OUT}/5-glass-chat.png` });
  await p.evaluate(() => history.back()); await p.waitForTimeout(1200);
  await swipe(100, 520, 220); await p.waitForTimeout(500);
  await p.click('.dk-in').catch(() => {}); await p.evaluate(() => { if (!document.querySelector('.sheet-wrap')) window.__openChatTest && __openChatTest(); });
  ok('无页面错误', errs.length === 0, errs);
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS', pass);
  await b.close();
})();
