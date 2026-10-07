// 5.18 原生 Wallpaper Engine 渲染：网页这边的接线（用假的 AmorNative 模拟原生层）
// ① 导入 .mpkg 场景 → 走原生：weStart 拿到解包目录、网页透明、取景框按 view() 发过去、离开首页拍虚化图并暂停、回首页继续
// ② 原生报失败 → 这张退回 WebGL 引擎照常显示
// ③ 设置里关掉「原生渲染」→ 收掉原生、用 WebGL；没有原生能力时开关不出现
const { chromium } = require('playwright');
const fs = require('fs');
const boot = require('./_boot515');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };

// 小场景包，按原生层 WallPackage.extract 的样子解在 /tmp 下（带 __yunduo_manifest.json），失败回退时 WebGL 引擎从这里读
function str(s) { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); }
function u32(...v) { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeInt32LE(x, i * 4)); return b; }
function tex(w, h, c) { const d = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) d.set(c, i * 4); return Buffer.concat([Buffer.from('TEXV0005\0TEXI0001\0'), u32(0, 0, w, h, w, h, 0), Buffer.from('TEXB0003\0'), u32(1, -1, 1, w, h, 0, 0, d.length), d]); }
const files = {
  'project.json': JSON.stringify({ title: '原生测试', type: 'scene', file: 'scene.json' }),
  'scene.json': JSON.stringify({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, objects: [{ id: 1, name: 'bg', image: 'models/bg.json', origin: '960 540 0', size: '1920 1080', scale: '1 1 1', angles: '0 0 0' }] }),
  'models/bg.json': JSON.stringify({ material: 'materials/bg.json' }),
  'materials/bg.json': JSON.stringify({ passes: [{ shader: 'genericimage2', blending: 'translucent', textures: ['bg'] }] }),
  'materials/bg.tex': tex(32, 32, [40, 90, 160, 255])
};
const DIR = '/tmp/we518/123_native.mpkg.assets', man = { ver: 'PKGV0001', files: {} };
fs.rmSync('/tmp/we518', { recursive: true, force: true });
Object.keys(files).forEach(n => { const f = DIR + '/' + n; fs.mkdirSync(require('path').dirname(f), { recursive: true }); fs.writeFileSync(f, files[n]); man.files[n] = 'file://' + f; });
fs.writeFileSync(DIR + '/__yunduo_manifest.json', JSON.stringify(man));
const PACK = 'file://' + DIR + '/__yunduo_manifest.json';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWNgYGD4z8DAwMDAwMAAAAAQAAEH8Ic1AAAAAElFTkSuQmCC';

function mock(mode) {   // mode: 'ok' | 'fail' | 'none'
  return `(() => {
    const L = window.__we = { calls: [], views: [], pauses: [], snaps: 0 };
    let pend = '';
    window.AmorNative = {
      wallPick() { setTimeout(() => { pend = JSON.stringify({ path: 'file:///tmp/we518/123_native.mpkg', name: 'native.mpkg', size: 1000, kind: 'scene', pack: '${PACK}' }); window.__wallIn(); }, 50); },
      takeWall() { const s = pend; pend = ''; return s; }, wallDelete() { return true; },
      weOk() { return ${mode !== 'none'}; }, weWhy() { return 'mock'; },
      weStart(dir, fps, speed) { L.calls.push(['start', dir, fps, speed]);
        setTimeout(() => { ${mode === 'fail' ? "window.__weState('fail', 'vk-init-error')" : "window.__weState('ready', '1920,1080|')"}; }, 300); return true; },
      weStop() { L.calls.push(['stop']); },
      weView(x, y, w, h) { L.views.push([x, y, w, h]); },
      wePause(p) { L.pauses.push(p); },
      weSpeed(s) { L.calls.push(['speed', s]); },
      weSnap(w, h, tag) { L.snaps++; setTimeout(() => window.__weSnap(tag, '${PNG}'), 30); }
    };
    if (!localStorage.getItem('wseed')) { localStorage.setItem('wseed', '1'); const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1') || '{}'); w.dyn = true; localStorage.setItem('cloud-weather-walls-v1', JSON.stringify(w)); }
  })()`;
}
async function importOne(p) {
  await p.evaluate(() => AmorNative.wallPick());
  await p.waitForFunction(() => { const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1')); return w.list.length && w.cur; }, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
}

(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  // ① 原生正常
  { const { p, ctx, errs } = await boot(b, { init: mock('ok') });
    await importOne(p);
    const st = await p.evaluate(() => ({ s: __Wall.state(), L: window.__we, nat: document.documentElement.classList.contains('we-nat'), ready: document.querySelector('#wall').classList.contains('ready'), bg: getComputedStyle(document.body).backgroundColor, canv: getComputedStyle(document.querySelector('#wall-back')).display }));
    ok('① 交给原生层：weStart 拿到解包目录', st.L.calls.some(c => c[0] === 'start' && c[1] === '/tmp/we518/123_native.mpkg.assets'.replace(/^/, 'file://') || c[0] === 'start' && /123_native\.mpkg\.assets$/.test(c[1])), st.L.calls);
    ok('① 原生就绪：state.native = ready，#wall.ready', st.s.native === 'ready' && st.ready, st.s);
    ok('① 网页透明（html.we-nat，body 背景透明，WebGL 画布藏起来）', st.nat && /rgba\(0, 0, 0, 0\)|transparent/.test(st.bg) && st.canv === 'none', { nat: st.nat, bg: st.bg, canv: st.canv });
    const v = st.L.views[st.L.views.length - 1] || [];
    ok('① 取景框：竖屏看横版场景，高 = 场景高，宽按屏幕比例', v.length === 4 && Math.abs(v[3] - 1080) < 1 && Math.abs(v[2] - 1080 * 412 / 915) < 3, v);
    ok('① 没有走 WebGL（只有一个记参数的代理，没有图层）', st.s.layers.length === 1 && st.s.layers[0] === 0, st.s);
    // 左右挪：focus 改到最左
    await p.evaluate(() => { const W = JSON.parse(localStorage.getItem('cloud-weather-walls-v1')); });
    await p.evaluate(() => { __Wall.adjust(true); });
    await p.evaluate(() => { const pad = document.querySelector('.wl-adj'); const r = pad.getBoundingClientRect(); const ev = (t, x) => pad.dispatchEvent(new PointerEvent(t, { pointerId: 1, clientX: x, clientY: 400, bubbles: true })); ev('pointerdown', 200); ev('pointermove', 400); ev('pointermove', 900); ev('pointerup', 900); });
    await p.waitForTimeout(300);
    const v2 = await p.evaluate(() => window.__we.views[window.__we.views.length - 1]);
    ok('① 拖动构图 → 新取景框发给原生（往右拖 = 看左边，x0 变小）', v2 && v2[0] < v[0] - 50, { before: v, after: v2 });
    await p.evaluate(() => __Wall.adjust(false));
    // 离开首页：拍虚化图、暂停；回来：继续
    const before = await p.evaluate(() => ({ snaps: window.__we.snaps, pauses: window.__we.pauses.slice() }));
    await p.evaluate(() => window.__goTab('settings')); await p.waitForTimeout(800);
    const away = await p.evaluate(() => ({ snaps: window.__we.snaps, pauses: window.__we.pauses.slice(), snap: document.querySelector('#wall').classList.contains('snap') }));
    ok('① 离开首页：拍了一张虚化图（.snap）', away.snaps > before.snaps && away.snap, away);
    ok('① 离开首页：原生暂停', away.pauses[away.pauses.length - 1] === true, away.pauses);
    await p.evaluate(() => window.__goTab('today')); await p.waitForTimeout(800);
    const back = await p.evaluate(() => window.__we.pauses.slice());
    ok('① 回到首页：原生继续', back[back.length - 1] === false, back);
    // 设置里有「原生渲染」开关，关掉 → weStop、改用 WebGL
    await p.evaluate(() => window.__goTab('settings')); await p.waitForTimeout(400);
    await p.evaluate(() => { const s = document.querySelector('[data-ui="wall"]'); if (s) s.click(); }); await p.waitForTimeout(600);
    const hasSw = await p.evaluate(() => !!document.querySelector('[data-wsw="native"]'));
    ok('③ 设置里有「原生渲染」开关', hasSw);
    await p.evaluate(() => { const e = document.querySelector('[data-wsw="native"]'); if (e) e.click(); }); await p.waitForTimeout(2500);
    const off = await p.evaluate(() => ({ s: __Wall.state(), L: window.__we, nat: document.documentElement.classList.contains('we-nat'), walls: JSON.parse(localStorage.getItem('cloud-weather-walls-v1')).native }));
    ok('③ 关掉开关：weStop、退出透明、记下 native=false', off.L.calls.some(c => c[0] === 'stop') && !off.nat && off.walls === false, { calls: off.L.calls, nat: off.nat, walls: off.walls });
    await p.waitForFunction(() => __Wall.state().layers.length >= 1 && !__Wall.state().native, null, { timeout: 30000 }).catch(() => {});
    const off2 = await p.evaluate(() => __Wall.state());
    ok('③ 关掉后用 WebGL 引擎画出来了', !off2.native && off2.layers.length === 2 && !off2.err, off2);
    ok('① 无页面错误', !errs.length, errs); await ctx.close(); }
  // ② 原生失败 → 退回 WebGL
  { const { p, ctx, errs } = await boot(b, { init: mock('fail') });
    await importOne(p);
    await p.waitForFunction(() => document.querySelector('#wall.ready') && __Wall.state().layers[0] > 0, null, { timeout: 60000 }).catch(() => {});
    const st = await p.evaluate(() => ({ s: __Wall.state(), nat: document.documentElement.classList.contains('we-nat'), L: window.__we, ready: document.querySelector('#wall').classList.contains('ready') }));
    ok('② 原生失败：记下原因、退回 WebGL 照常显示', st.s.nativeBad === 'vk-init-error' && !st.s.native && st.s.layers[0] > 0 && st.ready && !st.nat, st);
    ok('② 失败后收掉了原生（weStop）', st.L.calls.some(c => c[0] === 'stop'), st.L.calls);
    ok('② 无页面错误', !errs.length, errs); await ctx.close(); }
  // ③ 手机不支持：不出开关，直接 WebGL
  { const { p, ctx, errs } = await boot(b, { init: mock('none') });
    await importOne(p);
    await p.waitForFunction(() => document.querySelector('#wall.ready') && __Wall.state().layers[0] > 0, null, { timeout: 60000 }).catch(() => {});
    const st = await p.evaluate(() => ({ s: __Wall.state(), L: window.__we }));
    ok('③ 没有原生能力：不调 weStart，直接 WebGL', !st.L.calls.length && st.s.layers[0] > 0, st);
    await p.evaluate(() => window.__goTab('settings')); await p.waitForTimeout(400);
    await p.evaluate(() => { const s = document.querySelector('[data-ui="wall"]'); if (s) s.click(); }); await p.waitForTimeout(600);
    ok('③ 没有原生能力：设置里不出开关', await p.evaluate(() => !document.querySelector('[data-wsw="native"]')));
    ok('③ 无页面错误', !errs.length, errs); await ctx.close(); }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
