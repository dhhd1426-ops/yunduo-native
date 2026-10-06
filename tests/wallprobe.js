// 导入任意 .mpkg 看首页渲染：MPKG=路径 node tests/wallprobe.js → out/wallprobe/<名字>-home.png + 图层/警告
const { chromium } = require('playwright');
const boot = require('./_boot515');
const fs = require('fs');
const MPKG = process.env.MPKG || '/home/claude/wall/balloon.mpkg', NAME = require('path').basename(MPKG, '.mpkg'), OUT = 'out/wallprobe';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const vp = JSON.parse(process.env.VP || '[412,915]');
  const { p, errs } = await boot(b, { vp, scheme: 'dark', init: `(() => {
    if (!localStorage.getItem('probeSeed')) { localStorage.setItem('probeSeed', '1'); const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1') || '{}'); w.dyn = true; localStorage.setItem('cloud-weather-walls-v1', JSON.stringify(w)); }
    let pend = '';
    window.AmorNative = { wallPick() { setTimeout(() => { pend = JSON.stringify({ path: 'file://${MPKG}', name: 'x.mpkg', size: ${fs.statSync(MPKG).size}, kind: 'scene' }); window.__wallIn(); }, 200); }, takeWall() { const s = pend; pend = ''; return s; }, wallDelete() { return true; } };
  })()` });
  await p.waitForFunction(() => document.querySelector('#wall.ready'), null, { timeout: 120000 });
  await p.evaluate(() => { window.__goTab('settings'); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { const s = document.querySelector('[data-ui="wall"], [data-sub="wall"]'); if (s) s.click(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => AmorNative.wallPick());
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('cloud-weather-walls-v1')).list.length >= 2, null, { timeout: 180000 }).catch(() => {});
  await p.evaluate(() => { window.__goTab('today'); });
  await p.waitForFunction(() => __Wall.state().id && __Wall.state().id !== 'builtin' && document.querySelector('#wall.ready'), null, { timeout: 180000 }).catch(() => {});
  await p.waitForTimeout(+(process.env.WAIT || 6000));
  const st = await p.evaluate(() => __Wall.state());
  console.log(JSON.stringify({ id: st.id, nLayers: (st.kinds || []).map(k => k.length), worker: st.worker, warn: await p.evaluate(() => window.__wallWarn || null), wkErr2: await p.evaluate(() => window.__wallWkErr || null), rec: await p.evaluate(() => { const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1')); const c = w.list.find(x => x.id === w.cur); return c && c.warn; }) }, null, 1));
  await p.screenshot({ path: `${OUT}/${NAME}-home.png` });
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
