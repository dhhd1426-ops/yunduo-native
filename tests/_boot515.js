// 5.15 测试共用：和 motion514test 一样的假网络 + 种子数据；返回 { p, errs, ctl }
const fs = require('fs');
const docs = {}; fs.readdirSync('cma/docs').filter(f => !f.startsWith('_')).forEach(f => { const d = JSON.parse(fs.readFileSync('cma/docs/' + f, 'utf8')); docs[d.fid] = d; docs['n' + d.nid] = d; });
module.exports = async function boot(b, o) {
  o = o || {}; const VP = o.vp || [412, 915], reduce = !!o.reduce;
  const ctx = await b.newContext({ viewport: { width: VP[0], height: VP[1] }, hasTouch: true, isMobile: VP[0] < 700, timezoneId: 'Asia/Shanghai', reducedMotion: reduce ? 'reduce' : 'no-preference', colorScheme: o.scheme || 'light', recordVideo: o.video });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    const ctl = { chatFail: true, chatCalls: 0 }; let chatFail = true, chatCalls = 0;
    await p.route(/^https:\/\//, async route => {
      const u = new URL(route.request().url()), H = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }; let m;
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
      if (u.host === 'weather.cma.cn' && (m = u.pathname.match(/\/api\/now\/(.+)$/))) return route.fulfill({ headers: H, body: JSON.stringify({ code: 0, data: { location: { id: decodeURIComponent(m[1]) }, now: { temperature: 21, feelst: 20, humidity: 55, precipitation: 0, pressure: 1008, windDirection: '东北风', windScale: '2级', windSpeed: 2 }, alarm: [], lastUpdate: '2026/10/02 10:00' } }) });
      if (u.host === 'weather.cma.cn' && (m = u.pathname.match(/\/api\/weather\/(.+)$/))) { const id = decodeURIComponent(m[1]), d = docs[id] || docs['58457']; return route.fulfill({ headers: H, body: JSON.stringify({ code: 0, data: { location: { id }, daily: d.daily.map((x, i) => { const t = new Date(Date.now() + 8 * 3600e3 + i * 864e5), pd = n => String(n).padStart(2, '0'); return { date: t.getUTCFullYear() + '/' + pd(t.getUTCMonth() + 1) + '/' + pd(t.getUTCDate()), dayText: x.dt || '晴', nightText: x.nt || '多云', high: x.hi, low: x.lo, dayWindDirection: x.wd, dayWindScale: x.ws }; }), alarm: [], lastUpdate: '2026/10/02 08:00' } }) }); }
      if (u.host === 'api.deepseek.com' && u.pathname.endsWith('/chat/completions')) { ctl.chatCalls++; await new Promise(r => setTimeout(r, 900)); if (ctl.chatFail) return route.fulfill({ status: 401, headers: H, body: '{"error":{"message":"Authentication Fails"}}' }); return route.fulfill({ headers: H, body: JSON.stringify({ model: 'deepseek-chat', choices: [{ message: { content: '连接成功' } }] }) }); }
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
    if (o.init) await p.addInitScript(o.init);
    await p.goto('file://' + process.cwd() + '/' + (o.file || 'apk/www/index.html'));
    await p.waitForFunction(() => document.querySelector('#wall.ready'), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(1500);   // 等壁纸就绪（软件渲染编着色器时画面帧会卡住，动画计时不走）
  return { p, ctx, errs, ctl };
};
