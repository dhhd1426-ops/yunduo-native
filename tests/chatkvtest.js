// 5.17.3 聊天记录存成 App 文件（原生 Kv）：搬家 → 下次确认后删网页副本 → 新对话写进文件 → emoji 跨分块不乱码
const { chromium } = require('playwright');
const boot = require('./_boot515');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
// 假的原生 Kv：文件放在 sessionStorage（刷新页面还在），读的分块规则照 Kv.java（不切开代理对）
const MOCK = `(() => {
  const F = k => sessionStorage.getItem('__kv_' + k), pend = {}, cache = {};
  window.__kvCalls = { append: 0, commit: [] };
  window.AmorNative = Object.assign(window.AmorNative || {}, {
    kvBegin(k) { pend[k] = []; },
    kvAppend(k, s) { if (pend[k]) { const l = s.charCodeAt(s.length - 1), f = s.charCodeAt(0); if ((l >= 0xD800 && l <= 0xDBFF) || (f >= 0xDC00 && f <= 0xDFFF)) window.__kvBroken = true; pend[k].push(s); window.__kvCalls.append++; } },   // 每块单独过桥：块的两头不能是半个 emoji
    kvCommit(k, sync) { if (!pend[k]) return false; const s = pend[k].join(''); delete pend[k]; delete cache[k]; window.__kvCalls.commit.push(!!sync);
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0xD800 && c <= 0xDBFF && !(s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF)) { window.__kvBroken = true; } }   // 过桥后出现孤立的代理字符 = 乱码
      sessionStorage.setItem('__kv_' + k, s); return true; },
    kvLen(k) { const s = F(k); if (s == null) return -1; cache[k] = s; return s.length; },
    kvRead(k, off, n) { const s = cache[k]; if (s == null || off >= s.length) return ''; let e = Math.min(s.length, off + n); const c = s.charCodeAt(e - 1); if (e < s.length && e - off > 1 && c >= 0xD800 && c <= 0xDBFF) e--; return s.slice(off, e); },
    kvDel(k) { sessionStorage.removeItem('__kv_' + k); return true; }
  });
})()`;
// 旧的聊天记录：第一段放一个很长的内容，让 emoji 正好落在 256K 分块的边界上
const SEED = `(() => {
  if (localStorage.getItem('seedC')) return; localStorage.setItem('seedC', '1');
  const T = Date.now(), pre = '{"id":"c0","title":"很长的一段","msgs":[{"role":"user","content":"';
  const filler = new Array(262144 - pre.length - 1 - 1 + 1).join('长');   // 让 😀 的前半个代理字符正好是第 262144 个字符
  const chats = [
    { id: 'c0', title: '很长的一段', msgs: [{ role: 'user', content: filler + '😀🌧️ 结尾', t: T }, { role: 'assistant', content: '好 🙂', t: T }], created: T, updated: T },
    { id: 'c1', title: '面试好紧张', msgs: [{ role: 'user', content: '下周三去面试 😣', t: T - 1000 }, { role: 'assistant', content: '加油 💪', t: T - 1000 }], created: T - 1000, updated: T - 1000 },
    { id: 'c2', title: '西湖', msgs: [{ role: 'user', content: '还记得西湖吗', t: T - 2000 }], created: T - 2000, updated: T - 2000 }
  ];
  localStorage.setItem('cloud-weather-chats-v1', JSON.stringify(chats));
})()`;
(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] });
  const { p, ctx, errs } = await boot(b, { init: MOCK + ';' + SEED });
  await p.waitForTimeout(1200);
  const orig = await p.evaluate(() => localStorage.getItem('cloud-weather-chats-v1'));
  const f1 = await p.evaluate(() => sessionStorage.getItem('__kv_chats.json'));
  ok('第一次打开：聊天记录搬进了文件', !!f1 && f1 === orig, f1 && f1.length);
  ok('搬家是同步写完的（核对过才算数）', (await p.evaluate(() => __kvCalls.commit))[0] === true);
  ok('写的时候分了块（长内容不是一次过桥）', (await p.evaluate(() => __kvCalls.append)) >= 2, await p.evaluate(() => __kvCalls.append));
  ok('准备：😀 的前半个正好是第一块的最后一个字符', orig.charCodeAt(262143) === 0xD83D, orig.charCodeAt(262143).toString(16));
  ok('emoji 落在分块边界上也没被切开', !(await p.evaluate(() => window.__kvBroken)));
  ok('网页存储里的旧副本先留着（这次还没确认读得回来）', orig != null);
  await p.reload(); await p.waitForTimeout(1500);
  ok('第二次打开：从文件读回来后，网页存储里的旧副本删了', (await p.evaluate(() => localStorage.getItem('cloud-weather-chats-v1'))) === null);
  // 打开聊天看看旧对话都在（侧边栏列表）
  await p.click('.dk-in'); await p.waitForTimeout(900);
  const titles = await p.evaluate(() => { const s = document.querySelector('[data-chat="side"], .chat-top [data-chat="menu"]'); if (s) s.click(); return new Promise(r => setTimeout(() => r([...document.querySelectorAll('.sd-it')].map(x => x.textContent)), 900)); });
  ok('聊天记录从文件读回来了（侧边栏里有旧对话）', titles.some(t => t.includes('面试好紧张')) && titles.some(t => t.includes('西湖')), titles.slice(0, 4));
  await p.keyboard.press('Escape'); await p.evaluate(() => history.back()); await p.waitForTimeout(600);
  // 发一句新的：写进文件，网页存储里不再出现聊天记录
  await p.evaluate(() => { __kvCalls.commit = []; });
  await p.click('.chat-top [data-chat="new"]').catch(() => {}); await p.waitForTimeout(400);
  await p.fill('#chat-in', '今天穿什么好呢'); await p.click('#chat-send'); await p.waitForTimeout(2500);
  const f2 = JSON.parse(await p.evaluate(() => sessionStorage.getItem('__kv_chats.json')));
  ok('新对话写进了文件', f2.length === 4 && f2.some(c => (c.msgs || []).some(m => m.content === '今天穿什么好呢')), f2.length);
  ok('平时写文件交给后台线程（不同步等）', (await p.evaluate(() => __kvCalls.commit)).every(x => x === false));
  ok('网页存储里不再存聊天记录', (await p.evaluate(() => localStorage.getItem('cloud-weather-chats-v1'))) === null);
  const c0 = f2.find(c => c.id === 'c0');
  ok('跨分块的 emoji 读回来、再写回去都完好', c0 && c0.msgs[0].content.endsWith('😀🌧️ 结尾') && c0.msgs[1].content === '好 🙂');
  ok('无页面错误', !errs.length, errs);
  await ctx.close(); await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
