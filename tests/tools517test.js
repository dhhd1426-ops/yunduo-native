// 5.17 工具调用：Amor 说「记下了 / 设好了」时必须真的做了；做不了要照实说
// 假的 DeepSeek 接口按场景回话，检查笔记 / 日程有没有真的写进去、交回模型的工具结果对不对
const { chromium } = require('playwright');
const boot = require('./_boot515');
const FILE = process.env.AMOR_FILE || 'app/www/index.html';
let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined && !c ? '  ' + JSON.stringify(d).slice(0, 400) : '')); if (!c) { fails++; process.exitCode = 1; } };

const H = { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const sse = chunks => chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n';
const txt = t => sse([{ choices: [{ delta: { content: t } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const call = (name, args, extra) => sse([{ choices: [{ delta: { tool_calls: [Object.assign({ index: 0, id: 'c1', type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }, extra || {})] } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]);
const lastMsg = b => b.messages[b.messages.length - 1];
const sys = b => (b.messages[0] && b.messages[0].role === 'system' ? String(b.messages[0].content) : '');
const NOTE = { title: '番茄炒蛋', body: '- 鸡蛋 3 个\n- 番茄 2 个\n先炒蛋再炒番茄' };

async function run(b, name, handler, o) {
  o = o || {};
  const { p, ctx, errs } = await boot(b, { file: FILE, init: o.init });
  const reqs = [];
  await p.route(/(api\.deepseek\.com\/.*chat\/completions|api\.anthropic\.com\/v1\/messages)/, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
    const body = JSON.parse(route.request().postData() || '{}');
    if (/记忆整理器/.test(sys(body) + (typeof body.system === 'string' ? body.system : '')) || body.stream === false) return route.fulfill({ headers: Object.assign({}, H, { 'content-type': 'application/json' }), body: JSON.stringify({ choices: [{ message: { content: '{}' } }] }) });
    reqs.push(body);
    const r = handler(body, reqs.length);
    if (r && r.status) return route.fulfill({ status: r.status, headers: Object.assign({}, H, { 'content-type': 'application/json' }), body: JSON.stringify({ error: { message: r.msg } }) });
    return route.fulfill({ headers: H, body: r });
  });
  if (o.before) await p.evaluate(o.before);
  const n0 = await p.evaluate(() => __amorT.notes().length);
  const ask = async q => {
    await p.evaluate(q => { if (!__amorT.chat.open) __amorT.open(q); else { document.getElementById('chat-in').value = q; __amorT.open(q); } }, q);
    await p.waitForFunction(() => !__amorT.chat.busy, null, { timeout: 30000 });
    await p.waitForTimeout(300);
    return p.evaluate(() => { const c = __amorT.convs().filter(c => c.id === __amorT.chat.cur)[0]; const m = c && c.msgs[c.msgs.length - 1]; return { text: m && m.content, recall: m && m.recall, err: __amorT.chat.err }; });
  };
  return { p, ctx, errs, reqs, n0, ask, notes: () => p.evaluate(() => __amorT.notes()), close: async () => { ok(name + '：页面没有 JS 报错', !errs.length, errs); await ctx.close(); }, tag: name };
}

(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] });
  try {
    /* 1. 嘴上说记下了，其实没调用工具 → App 要追问一次，让她真的去存 */
    {
      const t = await run(b, 'claim', body => {
        const lm = lastMsg(body);
        if (lm.role === 'tool') return txt('存好了，放在笔记「番茄炒蛋」里。');
        if (body.messages.some(m => m.role === 'user' && /【系统核对】/.test(String(m.content)))) return call('save_note', NOTE);
        return txt('好的，已经帮你记下了！');
      });
      const r = await t.ask('帮我记一下番茄炒蛋的做法：鸡蛋 3 个，番茄 2 个，先炒蛋再炒番茄');
      const ns = await t.notes();
      ok('1 嘴上说记下了 → 笔记里真的多了一篇', ns.length === t.n0 + 1 && /番茄/.test(ns[0].title), { n0: t.n0, n: ns.length, text: r.text });
      ok('1 最后的回答是真的存了之后说的', /存好了/.test(r.text || '') && !/已经帮你记下了/.test(r.text || ''), r.text);
      await t.close();
    }
    /* 2. 思考参数不支持（400）→ 只能去掉思考参数，不能把工具永久关掉 */
    {
      const t = await run(b, 'effort400', body => {
        if (body.reasoning_effort) return { status: 400, msg: 'unknown parameter: reasoning_effort' };
        const lm = lastMsg(body);
        if (lm.role === 'tool') return txt('存好了。');
        if (body.tools && body.tools.length) return call('save_note', NOTE);
        return txt('好的，已经帮你记下了！');
      }, { before: () => { __amorT.asst.think = 3; } });
      const r = await t.ask('帮我记一下番茄炒蛋的做法');
      const pv = await t.p.evaluate(() => { const p = __amorT.prov('deepseek'); return { noTools: p.noTools, noToolsM: p.noToolsM, noEffort: p.noEffort }; });
      const ns = await t.notes();
      ok('2 思考参数 400 后：仍然带着工具请求', t.reqs.some(q => !q.reasoning_effort && q.tools && q.tools.length), t.reqs.map(q => [!!q.reasoning_effort, !!(q.tools && q.tools.length)]));
      ok('2 思考参数 400 后：供应商没有被标成「不支持工具」', !pv.noTools && !(pv.noToolsM && Object.keys(pv.noToolsM).length), pv);
      ok('2 笔记真的存上了', ns.length === t.n0 + 1, { n: ns.length, text: r.text });
      await t.close();
    }
    /* 3. 以前被误标成「不支持工具」（旧版的 noTools: true）→ 要重新试工具 */
    {
      const t = await run(b, 'legacyNoTools', body => {
        const lm = lastMsg(body);
        if (lm.role === 'tool') return txt('存好了。');
        if (body.tools && body.tools.length) return call('save_note', NOTE);
        return txt('好的，已经帮你记下了！');
      }, { init: `try{const k='cloud-weather-providers-v1',v=JSON.parse(localStorage.getItem(k)||'null');if(v){(Array.isArray(v)?v:Object.values(v)).forEach(p=>{if(p&&p.id==='deepseek'){p.noTools=true;p.toolsOk=false;}});localStorage.setItem(k,JSON.stringify(v));}else localStorage.setItem('__wantNoTools','1');}catch(e){}`,
        before: () => { const p = __amorT.prov('deepseek'); if (localStorage.getItem('__wantNoTools')) { p.noTools = true; p.toolsOk = false; } } });
      const before = await t.p.evaluate(() => !!__amorT.prov('deepseek').noTools);
      const r = await t.ask('帮我记一下番茄炒蛋的做法');
      const ns = await t.notes();
      ok('3 旧的「不支持工具」标记不再永久生效（请求里带了工具）', t.reqs.some(q => q.tools && q.tools.length), { before, reqs: t.reqs.length });
      ok('3 笔记真的存上了', ns.length === t.n0 + 1, { n: ns.length, text: r.text });
      await t.close();
    }
    /* 4. 流式里工具名每一块都重复发（一些中转站这样）→ 名字不能拼成 save_notesave_note */
    {
      const t = await run(b, 'dupName', body => {
        const lm = lastMsg(body);
        if (lm.role === 'tool') return txt('存好了。');
        const a = JSON.stringify(NOTE), h = Math.floor(a.length / 2);
        return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'save_note', arguments: a.slice(0, h) } }] } }] },
                    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'save_note', arguments: a.slice(h) } }] } }] },
                    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]);
      });
      await t.ask('帮我记一下番茄炒蛋的做法');
      const ns = await t.notes(), tm = t.reqs.map(q => lastMsg(q)).filter(m => m.role === 'tool')[0];
      ok('4 工具名重复发：笔记真的存上了', ns.length === t.n0 + 1 && /鸡蛋/.test(ns[0].body), { n: ns.length, tool: tm && tm.content });
      await t.close();
    }
    /* 5. 参数整段重复发了两遍（拼起来不是合法 JSON）→ 不能当成空参数去存一篇空笔记 */
    {
      const t = await run(b, 'dupArgs', body => {
        const lm = lastMsg(body);
        if (lm.role === 'tool') return txt('存好了。');
        const a = JSON.stringify(NOTE);
        return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'save_note', arguments: a } }] } }] },
                    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: a } }] } }] },
                    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]);
      });
      await t.ask('帮我记一下番茄炒蛋的做法');
      const ns = await t.notes();
      ok('5 参数重复两遍：存进去的是完整内容，不是空笔记', ns.length === t.n0 + 1 && /鸡蛋/.test(ns[0].body), { n: ns.length, body: ns[0] && ns[0].body });
      await t.close();
    }
    /* 6. 手机存储满了 → 工具要告诉模型「没存上」，不能说已存进 */
    {
      const t = await run(b, 'quota', body => {
        const lm = lastMsg(body);
        if (lm.role === 'tool') return txt(/没存上|失败|没成功/.test(lm.content) ? '抱歉，这次没存上。' : '存好了。');
        return call('save_note', NOTE);
      }, { before: () => { const s = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/notes/.test(k)) throw new Error('QuotaExceededError'); return s.apply(this, arguments); }; } });
      const r = await t.ask('帮我记一下番茄炒蛋的做法');
      const tm = t.reqs.map(q => lastMsg(q)).filter(m => m.role === 'tool')[0];
      const mem_ = await t.p.evaluate(() => __amorT.notes().length);
      ok('6 存储满：交回模型的结果写明没存上', tm && /没存上|失败|没成功/.test(tm.content) && !/^已存进/.test(tm.content), tm && tm.content);
      ok('6 存储满：界面里不留一篇重启就会消失的假笔记', mem_ === t.n0, { n0: t.n0, n: mem_ });
      ok('6 存储满：最后的回答照实说没存上', /没存上/.test(r.text || ''), r.text);
      await t.close();
    }
    /* 7. 必填内容是空的 → 不执行，告诉模型参数不对 */
    {
      const t = await run(b, 'empty', body => {
        const lm = lastMsg(body);
        if (lm.role === 'tool') return txt('好。');
        return call('save_note', { title: '', body: '' });
      });
      await t.ask('帮我记一下');
      const ns = await t.notes(), tm = t.reqs.map(q => lastMsg(q)).filter(m => m.role === 'tool')[0];
      ok('7 空内容：不存空笔记', ns.length === t.n0, { n: ns.length });
      ok('7 空内容：告诉模型没有执行', tm && /没有执行|没执行|没存/.test(tm.content), tm && tm.content);
      await t.close();
    }
    /* 8. 这家模型真的不支持工具 → 系统提示里写明这次存不了；她要是还说「记下了」，回答后面补一句实话 */
    {
      const t = await run(b, 'noToolsHonest', body => {
        if (body.tools && body.tools.length) return { status: 400, msg: 'tools is not supported' };
        return txt('好的，已经帮你记下了！');
      });
      const r = await t.ask('帮我记一下番茄炒蛋的做法');
      const last = t.reqs[t.reqs.length - 1];
      ok('8 不支持工具：系统提示里告诉她这次存不了笔记', /【这次用不了工具】[^\n]*笔记[^\n]*做不了/.test(sys(last)), sys(last).slice(-600));
      ok('8 不支持工具：她嘴上说记下了，回答末尾补上「其实没存」', /没有真的|并没有|没能/.test(r.text || ''), r.text);
      const pv = await t.p.evaluate(() => { const p = __amorT.prov('deepseek'); return { noTools: p.noTools, noToolsM: p.noToolsM }; });
      ok('8 不支持工具：只记在这个模型上，不是整个供应商', !pv.noTools && pv.noToolsM && pv.noToolsM['deepseek-chat'], pv);
      await t.close();
    }
    /* 9. 手机提醒用不了（不是安装版）→ 系统提示里要写明设不了提醒 */
    {
      const t = await run(b, 'noRemind', body => txt('好的。'));
      await t.ask('十分钟后提醒我关火');
      ok('9 设不了提醒时：系统提示里写明', /提醒/.test(sys(t.reqs[0])) && /设不了/.test(sys(t.reqs[0])), sys(t.reqs[0]).slice(-500));
      await t.close();
    }
    /* 10. 日程：add_event 存储失败也要照实交回 */
    {
      const t = await run(b, 'calQuota', body => {
        const lm = lastMsg(body);
        if (lm.role === 'tool') return txt(/没存上|失败|没成功/.test(lm.content) ? '这次没记上。' : '记好了。');
        return call('add_event', { date: '2026-10-09', time: '15:00', title: '牙医' });
      }, { before: () => { const s = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/calendar/.test(k)) throw new Error('QuotaExceededError'); return s.apply(this, arguments); }; } });
      await t.ask('周五下午三点看牙医，帮我记一下');
      const tm = t.reqs.map(q => lastMsg(q)).filter(m => m.role === 'tool')[0];
      ok('10 日程存储失败：交回模型的结果写明没存上', tm && /没存上|失败|没成功/.test(tm.content), tm && tm.content);
      await t.close();
    }
    /* 11. 工具本身抛错 → 这一轮不能整个崩掉，要把错误交回模型 */
    {
      const t = await run(b, 'throw', body => {
        const lm = lastMsg(body);
        if (lm.role === 'tool') return txt('这次没成功。');
        return call('add_event', { date: '2026-10-09', title: '牙医' });
      }, { before: () => { __amorT.cal().events.push = function () { throw new Error('boom'); }; } });
      const r = await t.ask('周五看牙医，帮我记一下');
      ok('11 工具抛错：回答照常完成，没有整轮报错', !r.err && /没成功/.test(r.text || ''), r);
      await t.close();
    }
    /* 12. 闲聊里说「记得早点睡」之类不能被当成假装存了而追问 */
    {
      const t = await run(b, 'noFalsePositive', body => txt('今天辛苦啦，记得早点睡，明天见～'));
      await t.ask('我今天好累');
      ok('12 普通闲聊不会被追问（只请求了一次）', t.reqs.length === 1, t.reqs.length);
      await t.close();
    }
    /* 13. 她被追问后还是只嘴上说 → 只追问一次，回答后面补实话（不会无限循环） */
    {
      const t = await run(b, 'stubborn', () => txt('好的，已经帮你记下了！'));
      const r = await t.ask('帮我记一下番茄炒蛋的做法');
      ok('13 一直嘴上说：最多追问一次（共 2 次请求）', t.reqs.length === 2, t.reqs.length);
      ok('13 一直嘴上说：回答后面补上「其实没存」', /并没有真的保存/.test(r.text || ''), r.text);
      ok('13 一直嘴上说：过程里留一条「没成功」', (r.recall || []).some(l => l.tool === 'fail'), r.recall);
      await t.close();
    }
    /* 14. 模型把调用写成 <tool_call> 文字 → 照样执行，文字不留在回答里 */
    {
      const t = await run(b, 'textCall', body => {
        const lm = lastMsg(body);
        if (lm.role === 'tool') return txt('存好了。');
        return txt('<tool_call>\n' + JSON.stringify({ name: 'save_note', arguments: NOTE }) + '\n</tool_call>');
      });
      const r = await t.ask('帮我记一下番茄炒蛋的做法');
      const ns = await t.notes();
      ok('14 文字形式的工具调用：笔记真的存上了', ns.length === t.n0 + 1 && /鸡蛋/.test(ns[0].body), { n: ns.length });
      ok('14 文字形式的工具调用：回答里不留 <tool_call>', !/tool_call/.test(r.text || ''), r.text);
      await t.close();
    }
    /* 15. Claude 接口（Anthropic 格式）：同样会追问，追问后真的存 */
    {
      const ant = chunks => chunks.map(c => 'event: ' + c.type + '\ndata: ' + JSON.stringify(c) + '\n\n').join('');
      const atxt = t => ant([{ type: 'message_start', message: { id: 'm', content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]);
      const acall = (n, a) => ant([{ type: 'message_start', message: { id: 'm', content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: n, input: {} } }, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(a) } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' }]);
      const t = await run(b, 'anth', body => {
        const lm = lastMsg(body);
        if (Array.isArray(lm.content) && lm.content.some(c => c.type === 'tool_result')) return atxt('存好了，放进笔记了。');
        if (body.messages.some(m => m.role === 'user' && /【系统核对】/.test(typeof m.content === 'string' ? m.content : ''))) return acall('save_note', NOTE);
        return atxt('好的，已经帮你记下了！');
      }, { before: () => { const p = __amorT.prov('anthropic'); p.key = 'sk-ant'; p.enabled = true; p.models = ['claude-test']; __amorT.asst.model = 'anthropic::claude-test'; __amorT.asst.think = 1; } });
      const r = await t.ask('帮我记一下番茄炒蛋的做法');
      const ns = await t.notes();
      ok('15 Claude 接口：追问后笔记真的存上了', ns.length === t.n0 + 1, { n: ns.length, text: r.text, reqs: t.reqs.length });
      ok('15 Claude 接口：工具结果按 Anthropic 格式交回', t.reqs.some(q => Array.isArray(lastMsg(q).content) && lastMsg(q).content[0].type === 'tool_result'), t.reqs.map(q => lastMsg(q)));
      ok('15 页面没有报错', !t.errs.length, t.errs);
      await t.close();
    }
  } finally { await b.close(); }
  console.log(fails ? fails + ' 项没过' : '全部通过');
})().catch(e => { console.error(e); process.exitCode = 1; });
