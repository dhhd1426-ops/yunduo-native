// 5.17.2 过一阵打开 App 变回自带壁纸：① 按天气自动换不再把手动选的（没标天气的）壁纸换掉 ② 存储被聊天记录占满时壁纸设置也能存下
const { chromium } = require('playwright');
const boot = require('./_boot515');
const IMG = 'file://' + process.cwd() + '/' + (require('fs').existsSync('apk') ? 'apk' : 'app') + '/www/walls/default-thumb.jpg';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const ALL = ['sun', 'cloud', 'rain', 'snow', 'fog', 'night'];
function seed(curTags) {
  return `(() => {
    if (localStorage.getItem('seedK')) return; localStorage.setItem('seedK', '1');
    localStorage.setItem('cloud-weather-walls-v1', JSON.stringify({ list: [
      { id: 'w1', name: '导入的', kind: 'image', path: ${JSON.stringify(IMG)}, thumb: '', focus: [.5, .5], zoom: 1, align: 'auto', tags: ${JSON.stringify(curTags)}, at: 1 },
      { id: 'builtin', tags: ${JSON.stringify(ALL)}, src: 'blueeyes', focus: [.54, .5], zoom: 1, align: 'auto' }
    ], cur: 'w1', wxKey: 'night|nothing', wxCity: 'hz', dyn: false, fps: 30, depth: true }));
  })()`;
}
const cur = p => p.evaluate(() => JSON.parse(localStorage.getItem('cloud-weather-walls-v1')).cur);
(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] });
  // ① 天气变了：手动选的这张没标天气 → 不换
  { const { p, ctx, errs } = await boot(b, { init: seed([]) }); await p.waitForTimeout(1500);
    ok('① 天气 / 昼夜变了，没标天气的导入壁纸不被换回自带', await cur(p) === 'w1', await cur(p));
    ok('① 天气标签记下了新天气', await p.evaluate(() => JSON.parse(localStorage.getItem('cloud-weather-walls-v1')).wxKey) !== 'night|nothing');
    ok('① 无页面错误', !errs.length, errs); await ctx.close(); }
  // 对照：当前这张也标了天气（在轮换里）→ 照常换到标了这种天气的
  { const { p, ctx, errs } = await boot(b, { init: seed(['zzz']) }); await p.waitForTimeout(1500);
    ok('① 对照：标了天气的壁纸照常按天气轮换', await cur(p) === 'builtin', await cur(p)); await ctx.close(); }
  // ② 存储被聊天记录占满，再选导入的壁纸 → 重开还是它
  { const { p, ctx, errs } = await boot(b, { init: seed([]) + `;(() => {
      if (!localStorage.getItem('__fill')) return; localStorage.removeItem('__fill');
      const S = new Array(40001).join('满'), T = Date.now(), mk = n => { const a = []; for (let i = 0; i < n; i++) a.push({ id: 'c' + i, title: '对话' + i, msgs: [{ role: 'user', content: S, t: T - i * 1000 }, { role: 'assistant', content: '好', t: T - i * 1000 }], created: T - i * 1000, updated: T - i * 1000 }); return a; };
      let lo = 0, hi = 300; while (lo < hi) { const m = Math.ceil((lo + hi) / 2); try { localStorage.setItem('cloud-weather-chats-v1', JSON.stringify(mk(m))); lo = m; } catch (e) { hi = m - 1; } }
      localStorage.setItem('__filled', String(lo)); localStorage.setItem('__roomBefore', 'false');
      const base = mk(lo); let a = 0, z = 200000; while (a < z) { const m = Math.ceil((a + z) / 2); base[0].msgs[1].content = '好' + new Array(m + 1).join('满'); try { localStorage.setItem('cloud-weather-chats-v1', JSON.stringify(base)); a = m; } catch (e) { z = m - 1; } }
      base[0].msgs[1].content = '好' + new Array(a + 1).join('满'); localStorage.setItem('cloud-weather-chats-v1', JSON.stringify(base));
      let room = true; try { localStorage.setItem('__t', new Array(201).join('x')); localStorage.removeItem('__t'); } catch (e) { room = false; } if (room) localStorage.setItem('__roomBefore', 'true');
    })()` });
    await p.evaluate(() => { const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1')); w.cur = 'builtin'; localStorage.setItem('cloud-weather-walls-v1', JSON.stringify(w)); localStorage.setItem('__fill', '1'); });
    await p.reload(); await p.waitForTimeout(2500);
    const filled = await p.evaluate(() => [localStorage.getItem('__filled'), localStorage.getItem('__roomBefore')]);
    ok('② 准备：聊天记录把存储塞满了（连 200 个字都写不进）', +filled[0] > 0 && filled[1] === 'false', filled);
    ok('② 准备：现在用的是自带那张', await cur(p) === 'builtin', await cur(p));
    // 在存储塞满的情况下导入一张图片壁纸（要多存一张缩略图）
    await p.evaluate(img => { window.AmorNative = Object.assign(window.AmorNative || {}, { takeWall: () => JSON.stringify({ path: img, kind: 'image', name: '新导入.jpg', size: 1000 }) }); window.__wallIn(); }, IMG);
    await p.waitForTimeout(2500);
    const newId = await p.evaluate(() => { const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1')); return w.list.some(x => x.id === w.cur && x.name === '新导入') ? w.cur : null; });
    ok('② 塞满时导入新壁纸：存进去了，而且是当前这张', !!newId, newId);
    await p.reload(); await p.waitForTimeout(2500);
    const after = await p.evaluate(() => { const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1')); const c = w.list.filter(x => x.id === w.cur)[0]; return c && c.name; });
    ok('② 重新打开 App，还是刚导入的那张', after === '新导入', after);
    const left = await p.evaluate(() => (JSON.parse(localStorage.getItem('cloud-weather-chats-v1')) || []).length);
    ok('② 是最旧的聊天记录让出了位置（少存了几段，不是全删）', left > 0 && left < +filled[0], { before: +filled[0], after: left });
    ok('② 无页面错误', !errs.length, errs); await ctx.close(); }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
