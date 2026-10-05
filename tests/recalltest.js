// 3.5 对话交互：思考过程行 / 时间线面板 / 模型胶囊 + 思考深度二级页 / 发送↔停止 / 复制 / 重新生成 / 逐级返回
const { chromium } = require('playwright');
const fs = require('fs');
const docs = {}; fs.readdirSync('cma/docs').filter(f=>!f.startsWith('_')).forEach(f=>{const d=JSON.parse(fs.readFileSync('cma/docs/'+f,'utf8')); docs[d.fid]=d; docs['n'+d.nid]=d;});
const bjNow = () => { const t=new Date(Date.now()+8*3600e3); const p=n=>String(n).padStart(2,'0'); return `${t.getUTCFullYear()}/${p(t.getUTCMonth()+1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`; };
const VP = JSON.parse(process.env.VP || '[412,915]'), CS = process.env.CS || 'dark', OUT = process.env.OUT || 'shots';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: VP[0], height: VP[1] }, deviceScaleFactor: 2, colorScheme: CS, hasTouch: true });
  const p = await ctx.newPage();
  // 4.0 浮岛导航盖在内容上：点之前先把目标滚到屏幕中间（__centerClick）
  { const _c = p.click.bind(p); p.click = async (sel, o) => { await p.$eval(sel, el => el.scrollIntoView({ block: 'center' })).catch(() => {}); return _c(sel, o); }; }
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const hits = [];
  await p.route('https://weather.cma.cn/**', async route => {
    const u = new URL(route.request().url()); hits.push(u.pathname);
    const H = {'content-type':'application/json','access-control-allow-origin':'*'};
    let m;
    if ((m = u.pathname.match(/\/api\/now\/(.+)$/))) {
      const d = docs['n'+decodeURIComponent(m[1])] || {now:{t:18,f:17,h:60,p:0,pr:1000,wd:'北风',ws:'微风',wv:1,al:[]}, nid: decodeURIComponent(m[1])};
      const n = d.now || {t:9999};
      return route.fulfill({headers:H, body: JSON.stringify({code:0,msg:'success',data:{location:{id:decodeURIComponent(m[1])},now:{temperature:n.t,feelst:n.f,humidity:n.h,precipitation:n.p,pressure:n.pr,windDirection:n.wd||'9999',windScale:n.ws,windSpeed:n.wv},alarm:(n.al||[]).map(t=>({title:t})),lastUpdate:bjNow()}})});
    }
    if ((m = u.pathname.match(/\/api\/weather\/(.+)$/))) {
      const id = decodeURIComponent(m[1]); const d = docs[id] || docs['58457'];
      return route.fulfill({headers:H, body: JSON.stringify({code:0,msg:'success',data:{location:{id},daily:d.daily.map(x=>({date:x.d,dayText:x.dt||'9999',nightText:x.nt||'9999',high:x.hi,low:x.lo,dayWindDirection:x.wd,dayWindScale:x.ws})),alarm:[],lastUpdate:'2026/09/26 08:00'}})});
    }
    if (u.pathname.includes('/api/dict/province/AZJ')) return route.fulfill({headers:H, body: JSON.stringify({code:0,msg:'success',data:'58457,杭州|58556,绍兴|58559,上虞|58450,安吉'})});
    return route.fulfill({status:404, body:''});
  });
  await p.addInitScript(() => {
    if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1');
      localStorage.setItem('cloud-weather-app-v2', JSON.stringify({ cities: ['bj'], current: 'bj', name: '小宇', tab: 'today', splashMode: 'off' }));
      localStorage.setItem('cloud-weather-deepseek', JSON.stringify({ key: 'sk-fake', base: 'https://api.deepseek.com/v1', path: '/chat/completions', enabled: true, model: 'deepseek-v4-pro', models: ['deepseek-v4-pro'], available: [] }));
      const D = 86400e3, now = Date.now();
      localStorage.setItem('cloud-weather-chats-v1', JSON.stringify([
        { id: 'r1', title: '面试好紧张', city: 'bj', created: now - 6 * D, updated: now - 6 * D, pinned: false, msgs: [
          { role: 'user', content: '下周三要去字节面试产品设计岗，好紧张', ts: now - 6 * D }, { role: 'assistant', content: '别紧张！先把作品集里最得意的三个项目讲顺，面试官最爱问设计决策背后的原因。', ts: now - 6 * D },
          { role: 'user', content: '作品集用哪个项目开头比较好', ts: now - 6 * D + 60e3 }, { role: 'assistant', content: '用云朵天气开头吧，有动效、有完整的设计过程，最能体现你的特点。', ts: now - 6 * D + 90e3 } ] },
        { id: 'r2', title: '周末去西湖', city: 'hz', created: now - 9 * D, updated: now - 9 * D, pinned: false, msgs: [
          { role: 'user', content: '周末想去西湖骑车，从哪里出发好', ts: now - 9 * D }, { role: 'assistant', content: '可以从北山街出发，沿白堤骑到苏堤，傍晚的光最好看。', ts: now - 9 * D } ] },
        { id: 'a1', title: '你好', city: 'bj', created: now - 20 * D, updated: now - 20 * D, pinned: false, msgs: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好呀' }] },
        { id: 'a2', title: '帮我出个主意', city: 'bj', created: now - 4 * D - 3600e3, updated: now - 4 * D, pinned: false, msgs: [{ role: 'user', content: '帮我出个主意' }, { role: 'assistant', content: '好' }, { role: 'user', content: '谢谢' }, { role: 'assistant', content: '不客气' }] }
      ])); }
    window.__sent = [];
    const Real = XMLHttpRequest;
    window.XMLHttpRequest = function () {
      const real = new Real(), me = this; let url = '';
      me.open = (m, u, a) => { url = u; real.open(m, u, a); };
      me.setRequestHeader = (h, v) => real.setRequestHeader(h, v);
      Object.defineProperty(me, 'timeout', { set: v => {}, get: () => 0 });
      me.abort = () => {};
      me.send = (body) => {
        if (!url.includes('chat/completions') && !url.includes('/messages')) {
          ['onload','onerror','ontimeout','onprogress','onreadystatechange'].forEach(k => { real[k] = (...a) => me[k] && me[k](...a); });
          ['status','responseText','readyState','response'].forEach(k => Object.defineProperty(me, k, {get: () => real[k], configurable: true}));
          return real.send(body);
        }
        const j = JSON.parse(body); window.__sent.push(j);
        let resp = ''; me.readyState = 3;
        Object.defineProperty(me, 'responseText', { get: () => resp });
        const done = () => { me.readyState = 4; me.onload && me.onload(); };
        if (!j.stream) { me.status = 200; setTimeout(() => { resp = JSON.stringify({ choices: [{ message: { content: '{}' } }] }); done(); }, 100); return; }
        if (j.tools && localStorage.getItem('__noTools')) { me.status = 400; setTimeout(() => { resp = '{"error":{"message":"tools not supported"}}'; done(); }, 50); return; }
        me.status = 200;
        const anth = url.includes('/messages');
        const msgs = j.messages, last = msgs[msgs.length - 1];
        const userText = anth ? (typeof last.content === 'string' ? last.content : '') : (last.role === 'user' ? last.content : '');
        const sse = (o) => { resp += (anth ? 'event: x\n' : '') + 'data: ' + JSON.stringify(o) + '\n\n'; me.onprogress && me.onprogress({}); };
        let t = 0; const at = (ms, f) => { t += ms; setTimeout(f, t); };
        const say = (text) => { for (let i = 0; i < text.length; i += 3) { const pc = text.slice(i, i + 3); at(35, () => anth ? sse({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: pc } }) : sse({ choices: [{ delta: { content: pc } }] })); } };
        const thinkSay = (th) => { for (let i = 0; i < th.length; i += 4) { const pc = th.slice(i, i + 4); at(30, () => anth ? sse({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: pc } }) : sse({ choices: [{ delta: { reasoning_content: pc } }] })); } };
        const wantsTool = j.tools && /上次|还记得|之前/.test(userText || '');
        const toolResult = anth ? (Array.isArray(last.content) && last.content[0].type === 'tool_result' ? last.content[0].content : null) : (last.role === 'tool' ? last.content : null);
        if (anth) at(10, () => sse({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }));
        if (wantsTool) {
          thinkSay('他提到上次的面试，我去翻一下以前的聊天。');
          if (anth) {
            at(20, () => sse({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } }));
            at(20, () => sse({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'search_past_chats', input: {} } }));
            at(20, () => sse({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query": "面试' } }));
            at(20, () => sse({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ' 作品集"}' } }));
          } else {
            at(20, () => sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search_past_chats', arguments: '' } }] } }] }));
            at(20, () => sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query": "面试' } }] } }] }));
            at(20, () => sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ' 作品集"}' } }] } }] }));
          }
          at(600, () => { resp += anth ? '' : 'data: [DONE]\n\n'; done(); });
          return;
        }
        if (toolResult) {
          window.__toolResult = toolResult;
          thinkSay('找到了：他打算用云朵天气开头。');
          if (anth) at(10, () => sse({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }));
          say(/云朵天气/.test(toolResult) ? '记得呀！你上次说下周三去字节面试，作品集我们定的是用云朵天气开头～准备得怎么样了？' : '这个我记不太清了。');
        } else {
          if (anth) at(10, () => sse({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }));
          say('有只企鹅走进冰淇淋店……（笑话）');
        }
        at(60, () => { resp += anth ? '' : 'data: [DONE]\n\n'; done(); });
      };
    };
  });
  await p.goto('file://' + process.cwd() + '/apk/www/index.html');
  await p.waitForTimeout(1500);
  const nav = () => p.evaluate(() => history.state && history.state.nav);
  const shot = (n) => p.screenshot({ path: `${OUT}/rc-${VP[0]}-${CS}-${n}.png` });
  // 设置页入口
  await p.evaluate(() => __goTab('settings')); await p.waitForTimeout(600);
  console.log('entry:', await p.evaluate(() => document.querySelector('[data-ui="memory"] .d').textContent));
  await p.evaluate(() => document.querySelector('[data-ui="memory"]').scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
  await shot('0-settings');
  const lastSys = () => p.evaluate(() => { const s = window.__sent.filter(x => x.stream).slice(-1)[0]; return s.system || s.messages[0].content; });
  const streams = () => p.evaluate(() => window.__sent.filter(x => x.stream).map(x => (x.tools ? 'T' : '-') + x.messages.length));
  // 1) 闲聊：模型不查
  await p.evaluate(() => __goTab('today')); await p.waitForTimeout(500);
  await p.click('.dk-in'); await p.waitForTimeout(900);
  await p.fill('#chat-in', '给我讲个笑话'); await p.click('#chat-send'); await p.waitForTimeout(2500);
  console.log('[chit-chat] requests', await streams(), '| proc:', await p.evaluate(() => (document.querySelector('.proc .pl') || {}).textContent || '(none)'));
  const s1 = await lastSys(); console.log('  rule in prompt:', s1.includes('【全局记忆：调阅以前的聊天】'), '| snippets injected:', s1.includes('相关的旧对话片段'));
  // 2) 提到以前：模型自己调工具
  await p.fill('#chat-in', '还记得我上次说的面试吗，作品集后来怎么定的'); await p.click('#chat-send');
  await p.waitForTimeout(1500); await shot('1-recalling');
  console.log('[recall] live row:', await p.evaluate(() => (document.getElementById('proc-line') || {}).textContent));
  await p.waitForTimeout(4000);
  console.log('  requests', await streams());
  console.log('  tool result →', (await p.evaluate(() => window.__toolResult || '')).split('\n').slice(0, 3).join(' / '));
  const round2 = await p.evaluate(() => window.__sent.filter(x => x.stream).slice(-1)[0].messages.slice(-2));
  console.log('  round2 assistant msg keys:', Object.keys(round2[0]).join(','), '| tool msg:', round2[1].role, round2[1].tool_call_id);
  console.log('  answer:', await p.evaluate(() => [...document.querySelectorAll('.msg.bot')].pop().textContent));
  console.log('  proc:', await p.evaluate(() => [...document.querySelectorAll('.proc .pl')].pop().textContent));
  await shot('2-answer');
  await p.click('.proc >> nth=-1'); await p.waitForTimeout(700); await shot('3-timeline');
  console.log('  timeline:', await p.evaluate(() => [...document.querySelectorAll('.tl-it b')].map(x => x.textContent).join(' → ')));
  await p.click('[data-tstep^="t"]'); await p.waitForTimeout(600); await p.click('.rc'); await p.waitForTimeout(700);
  console.log('  opened:', await p.evaluate(() => document.querySelector('.chat-top .ttl b').textContent));
  // 3) 不支持工具的模型：兜底
  await p.evaluate(() => { localStorage.setItem('__noTools', '1'); const P = JSON.parse(localStorage.getItem('cloud-weather-providers-v1')); P.forEach(x => { delete x.toolsOk; delete x.noTools; delete x.toolsOkM; delete x.noToolsM; }); localStorage.setItem('cloud-weather-providers-v1', JSON.stringify(P)); });
  await p.reload(); await p.waitForTimeout(1500);
  await p.click('.dk-in'); await p.waitForTimeout(900);
  await p.click('.chat-top [data-chat="new"]'); await p.waitForTimeout(400);
  console.log('  flag before send:', await p.evaluate(() => localStorage.getItem('__noTools')), await p.evaluate(() => localStorage.getItem('cloud-weather-providers-v1').includes('toolsOk')));
  await p.fill('#chat-in', '还记得西湖那次吗'); await p.click('#chat-send'); await p.waitForTimeout(3000);
  const s3 = await lastSys();
  console.log('[no-tools] requests', await streams(), '| fallback snippets:', s3.includes('相关的旧对话片段') && s3.includes('西湖'), '| noTools saved:', await p.evaluate(() => JSON.parse(localStorage.getItem('cloud-weather-providers-v1')).find(x => x.id === 'deepseek').noTools));
  console.log('  proc:', await p.evaluate(() => [...document.querySelectorAll('.proc .pl')].pop().textContent));
  await p.fill('#chat-in', '讲个笑话'); await p.click('#chat-send'); await p.waitForTimeout(2500);
  console.log('  no-tools chit-chat snippets?', (await lastSys()).includes('相关的旧对话片段'));
  // 4) Claude（Anthropic 接口）
  await p.evaluate(() => {
    localStorage.removeItem('__noTools');
    const P = JSON.parse(localStorage.getItem('cloud-weather-providers-v1'));
    const a = P.find(x => x.id === 'anthropic'); a.key = 'sk-ant-fake'; a.models = ['claude-test']; a.enabled = true;
    localStorage.setItem('cloud-weather-providers-v1', JSON.stringify(P));
    const A = JSON.parse(localStorage.getItem('cloud-weather-assistant-v1') || '{}'); A.model = 'anthropic::claude-test'; A.think = 3; localStorage.setItem('cloud-weather-assistant-v1', JSON.stringify(A));
  });
  await p.reload(); await p.waitForTimeout(1500);
  await p.click('.dk-in'); await p.waitForTimeout(900); await p.click('.chat-top [data-chat="new"]'); await p.waitForTimeout(300);
  await p.fill('#chat-in', '还记得我上次说的面试吗'); await p.click('#chat-send'); await p.waitForTimeout(5500);
  const an = await p.evaluate(() => { const x = window.__sent.filter(x => x.stream).slice(-1)[0]; return { n: x.messages.length, asst: JSON.stringify(x.messages[x.messages.length - 2].content).slice(0, 220), res: JSON.stringify(x.messages[x.messages.length - 1].content).slice(0, 80) }; });
  console.log('[claude] round2', an);
  console.log('  answer:', await p.evaluate(() => [...document.querySelectorAll('.msg.bot')].pop().textContent));
  console.log('errors', errs);
  await b.close();
})();
