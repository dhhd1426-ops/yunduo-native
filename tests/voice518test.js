// 5.18 说话方式：看场合换语气的规则、分条发（拆成几条 + 条间停顿）、去掉客服式结尾、旧默认人设迁移
const { chromium } = require('playwright');
const boot = require('./_boot515');
const FILE = process.env.AMOR_FILE || 'app/www/index.html';
let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined && !c ? '  ' + JSON.stringify(d).slice(0, 400) : '')); if (!c) { fails++; process.exitCode = 1; } };
const H = { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const txt = t => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
const sys = b => (b.messages[0] && b.messages[0].role === 'system' ? String(b.messages[0].content) : '');
const OLD = '你是 Amor，{name} 的私人助理，也是随时可以聊天的朋友。\n你温暖、聪明、有好奇心，偶尔幽默。什么都可以聊：日常小事、心情、工作学习、写东西、出主意，或者只是闲聊。\n说话自然口语化，像朋友发消息；简单的问题简短回答，复杂的问题可以分点讲清楚。\n不知道的事就坦白说不知道，不要编造。';

async function run(b, reply, o) {
  o = o || {};
  const { p, ctx, errs } = await boot(b, { file: FILE, init: o.init });
  const reqs = [];
  await p.route(/api\.deepseek\.com\/.*chat\/completions/, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.stream === false) return route.fulfill({ headers: Object.assign({}, H, { 'content-type': 'application/json' }), body: JSON.stringify({ choices: [{ message: { content: '{}' } }] }) });
    reqs.push(body);
    return route.fulfill({ headers: H, body: txt(typeof reply === 'function' ? reply(body) : reply) });
  });
  const ask = async (q, watch) => {
    const seen = [];
    await p.evaluate(q => __amorT.open(q), q);
    if (watch) {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        const st = await p.evaluate(() => { const el = document.getElementById('partial'); return { shown: el ? el.textContent : null, partial: __amorT.chat.partial, busy: __amorT.chat.busy }; });
        seen.push(st); if (!st.busy && st.shown == null) break; await p.waitForTimeout(40);
      }
    }
    await p.waitForFunction(() => !__amorT.chat.busy, null, { timeout: 30000 });
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const c = __amorT.convs().filter(c => c.id === __amorT.chat.cur)[0], m = c && c.msgs[c.msgs.length - 1];
      const box = document.getElementById('msgs'), last = box ? [...box.querySelectorAll('.msg.bot[data-bi]')] : [];
      const bi = m ? String(c.msgs.length - 1) : '';
      const mine = last.filter(e => e.getAttribute('data-bi') === bi);
      return { text: m && m.content, segs: mine.length, segTexts: mine.map(e => e.textContent.trim()), inSeq: mine.every(e => e.closest('.msg-seq')), visible: box ? box.textContent : '' };
    });
    r.seen = seen; return r;
  };
  return { p, reqs, ask, errs, close: async () => { ok('页面没有 JS 报错', !errs.length, errs); await ctx.close(); } };
}

(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] });
  try {
    /* 1. 系统提示里有「看场合换说话方式」和「分条发」，新的默认人设 */
    {
      const t = await run(b, '嗯嗯');
      await t.ask('今天吃了火锅');
      const s = sys(t.reqs[0]);
      ok('1 系统提示：有【怎么说话】三种情况', /【怎么说话】/.test(s) && /闲聊/.test(s) && /接住情绪/.test(s) && /干脆利落/.test(s), s.slice(0, 300));
      ok('1 系统提示：有【分条发】和 [下一条] 用法', /【分条发】[^\n]*\[下一条\]/.test(s));
      ok('1 系统提示：有【别像 AI】和【诚实】', /【别像 AI】/.test(s) && /【诚实】[^\n]*AI/.test(s));
      ok('1 新的默认人设', /最懂 TA 的朋友/.test(s) && !/随时可以聊天的朋友/.test(s), s.slice(0, 120));
      await t.close();
    }
    /* 2. 旧版存下来的默认人设自动换新；自己写的人设不动 */
    {
      const seed = p => `const k='cloud-weather-assistant-v1',a=JSON.parse(localStorage.getItem(k)||'{}');a.prompt=${JSON.stringify(p)};localStorage.setItem(k,JSON.stringify(a));`;
      let t = await run(b, '嗯', { init: seed(OLD) });
      ok('2 旧默认人设 → 换成新的', await t.p.evaluate(() => /最懂 TA 的朋友/.test(__amorT.asst.prompt)));
      await t.close();
      t = await run(b, '嗯', { init: seed('你是小宇的猫，说话带喵。') });
      ok('2 自己写的人设 → 不动', await t.p.evaluate(() => __amorT.asst.prompt === '你是小宇的猫，说话带喵。'));
      await t.ask('在吗');
      ok('2 自己写的人设也带上【怎么说话】', /你是小宇的猫/.test(sys(t.reqs[0])) && /【怎么说话】/.test(sys(t.reqs[0])));
      await t.close();
    }
    /* 3. 分条发：拆成几条显示；写的过程中条与条之间停一下；界面里看不到 [下一条] */
    {
      const R = '哈哈哈真的假的\n[下一条]\n火锅配冰可乐，绝了吧\n[下一条]\n下次带我一个';
      const t = await run(b, R);
      const r = await t.ask('今天吃了火锅', true);
      ok('3 存下来的原文保留分条标记（下一轮她能看到自己的习惯）', /\[下一条\]/.test(r.text || ''), r.text);
      ok('3 显示成 3 条', r.segs === 3 && r.inSeq, r);
      ok('3 每条的文字对得上', r.segTexts[0] === '哈哈哈真的假的' && /冰可乐/.test(r.segTexts[1]) && r.segTexts[2] === '下次带我一个', r.segTexts);
      ok('3 界面里看不到 [下一条]', !/下一条/.test(r.visible), r.visible.slice(-200));
      const paused = r.seen.some(x => x.shown != null && /真的假的/.test(x.shown) && !/冰可乐/.test(x.shown) && /冰可乐/.test(x.partial));
      ok('3 写的过程中：第一条写完会停一下再写第二条', paused, r.seen.filter(x => x.shown).map(x => x.shown).slice(0, 12));
      ok('3 写的过程中也不露出 [下一条]', !r.seen.some(x => x.shown && /[\[［]下/.test(x.shown)), r.seen.map(x => x.shown).filter(Boolean).slice(-4));
      await t.close();
    }
    /* 4. 不分条的回复照旧是一条 */
    {
      const t = await run(b, '周五下午三点，牙医，记好了。');
      const r = await t.ask('周五下午三点看牙医');
      ok('4 不分条：还是一条、不包 .msg-seq', r.segs === 1 && !r.inSeq, r);
      await t.close();
    }
    /* 5. 客服式结尾去掉；整条只有这一句就留着 */
    {
      let t = await run(b, '火锅配冰可乐确实绝。\n\n希望对你有帮助～');
      let r = await t.ask('火锅配什么喝');
      ok('5 去掉「希望对你有帮助」', r.text === '火锅配冰可乐确实绝。', r.text);
      await t.close();
      t = await run(b, '可以先把番茄去皮再炒。如果还有其他问题，随时告诉我！');
      r = await t.ask('番茄炒蛋怎么更好吃');
      ok('5 去掉「如果还有其他问题随时告诉我」', r.text === '可以先把番茄去皮再炒。', r.text);
      await t.close();
      t = await run(b, '哈哈哈\n[下一条]\n有什么需要随时叫我');
      r = await t.ask('你好');
      ok('5 分条最后一条是套话：连同标记一起去掉', r.text === '哈哈哈', r.text);
      await t.close();
      t = await run(b, '希望对你有帮助！');
      r = await t.ask('谢谢');
      ok('5 整条只有这一句：留着', r.text === '希望对你有帮助！', r.text);
      await t.close();
      t = await run(b, '我希望你明天面试顺利，加油。');
      r = await t.ask('明天面试');
      ok('5 正常的「希望」不误删', r.text === '我希望你明天面试顺利，加油。', r.text);
      await t.close();
    }
  } finally { await b.close(); }
  console.log(fails ? fails + ' 项没过' : '全部通过');
})().catch(e => { console.error(e); process.exitCode = 1; });
