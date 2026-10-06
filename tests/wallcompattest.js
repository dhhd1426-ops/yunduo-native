// 5.17.4 壁纸兼容：一层坏了只跳过这一层 / 贴图格式 5 / 包里没带的 WE 自带粒子贴图用替代图（雨丝不再变成白雾）/ projectlayer + 模糊（common_composite.h）
// 不依赖真实壁纸：现场拼一个小 .mpkg（PKGV0001），在 App 页面里直接用 WallScene 加载，再走一遍导入看界面提示
const { chromium } = require('playwright');
const fs = require('fs');
const boot = require('./_boot515');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const WWW = (fs.existsSync('apk') ? 'apk' : 'app') + '/www/';

function str(s) { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); }
function u32(...v) { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeInt32LE(x, i * 4)); return b; }
function tex(fmt, w, h, data) {   // TEXV0005 / TEXI0001 / TEXB0003，不压缩
  return Buffer.concat([Buffer.from('TEXV0005\0TEXI0001\0'), u32(fmt, 0, w, h, w, h, 0), Buffer.from('TEXB0003\0'), u32(1, -1, 1, w, h, 0, 0, data.length), data]);
}
function mpkg(files) {
  const names = Object.keys(files), blobs = names.map(n => Buffer.isBuffer(files[n]) ? files[n] : Buffer.from(typeof files[n] === 'string' ? files[n] : JSON.stringify(files[n])));
  let off = 0; const idx = names.map((n, i) => { const e = Buffer.concat([str(n), u32(off, blobs[i].length)]); off += blobs[i].length; return e; });
  return Buffer.concat([str('PKGV0001'), u32(names.length), ...idx, ...blobs]);
}
const rgba = (w, h, c) => { const b = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { b[i * 4] = c[0]; b[i * 4 + 1] = c[1]; b[i * 4 + 2] = c[2]; b[i * 4 + 3] = c[3]; } return b; };
function img(name, fmt, w, h, data, extra) {
  return { [`models/${name}.json`]: { material: `materials/${name}.json` }, [`materials/${name}.json`]: { passes: [{ shader: 'genericimage2', blending: 'translucent', textures: [name] }] }, [`materials/${name}.tex`]: tex(fmt, w, h, data) };
}
// 格式 5（按 DXT5 的块结构）：一块 4×4 = 16 字节；alpha 端点 255/255 → 不透明，颜色端点 0xF800（红）
const dxt5 = Buffer.alloc(16 * 16); for (let k = 0; k < 16; k++) { dxt5[k * 16] = 255; dxt5[k * 16 + 1] = 255; dxt5.writeUInt16LE(0xF800, k * 16 + 8); dxt5.writeUInt16LE(0xF800, k * 16 + 10); }
const blurDir = '/home/claude/wall/w2798/';   // 模糊特效的着色器取自 WE 的标准 effects/blur（有这个解包目录就用，没有就跳过那一项）
const files = Object.assign({},
  img('bg', 0, 64, 64, rgba(64, 64, [40, 60, 80, 255])),
  img('broken', 99, 64, 64, Buffer.alloc(37)),             // 不认识的格式、大小也对不上 → 解不出来
  img('fmt5', 5, 16, 16, dxt5),
  img('girl', 0, 32, 32, rgba(32, 32, [200, 150, 120, 255])),
  { 'particles/rain.json': { material: 'materials/rain.json', maxcount: 8, emitter: [{ name: 'boxrandom', rate: 10, distancemax: '100 100 0' }], initializer: [{ name: 'lifetimerandom', min: 1, max: 1 }, { name: 'sizerandom', min: 400, max: 400 }], renderer: [{ name: 'sprite' }] },
    'materials/rain.json': { passes: [{ shader: 'genericparticle', blending: 'additive', textures: ['particle/nature/rain1'] }] },
    'project.json': { title: '兼容测试', type: 'scene', file: 'scene.json' } });
const hasBlur = fs.existsSync(blurDir + 'effects/blur/effect.json');
if (hasBlur) ['effects/blur/effect.json', 'materials/effects/blur_downsample4.json', 'materials/effects/blur_gaussian_x.json', 'materials/effects/blur_gaussian_y.json', 'materials/effects/blur_combine.json',
  'shaders/effects/blur_downsample4.frag', 'shaders/effects/blur_downsample4.vert', 'shaders/effects/blur_gaussian.frag', 'shaders/effects/blur_gaussian.vert', 'shaders/effects/blur_combine.frag', 'shaders/effects/blur_combine.vert']
  .forEach(f => { files[f] = fs.readFileSync(blurDir + f); });
const O = (id, name, extra) => Object.assign({ id, name, origin: '100 100 0', size: '200 200', scale: '1 1 1', angles: '0 0 0' }, extra);
files['scene.json'] = { general: { orthogonalprojection: { width: 200, height: 200 } }, objects: [
  O(1, 'bg', { image: 'models/bg.json' }),
  O(2, '坏贴图', { image: 'models/broken.json' }),
  O(3, '大雨', { particle: 'particles/rain.json' }),
  O(4, '全景合成层', { image: 'models/util/projectlayer.json', copybackground: true, effects: hasBlur ? [{ file: 'effects/blur/effect.json', visible: true, passes: [{}, { constantshadervalues: { scale: '1 1' } }, { combos: { VERTICAL: 1 }, constantshadervalues: { scale: '1 1' } }, {}] }] : [] }),
  O(5, '蕨', { image: 'models/fmt5.json', size: '16 16' }),
  O(6, '人物', { image: 'models/girl.json', size: '32 32' })
] };
const PKG = '/tmp/wallcompat.mpkg'; fs.writeFileSync(PKG, mpkg(files));

(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  // ① 直接用引擎（主线程）加载：看每层的结果
  { const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + process.cwd() + '/' + WWW + 'index.html'); await p.waitForTimeout(1500);
    const r = await p.evaluate(async path => {
      const buf = await new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', 'file://' + path); x.responseType = 'arraybuffer'; x.onload = () => ok(x.response); x.onerror = no; x.send(); });
      const sc = new WallScene.Scene(WallScene.unpack(buf)), L = sc.layers(), cv = document.createElement('canvas'); cv.width = cv.height = 200;
      const R = new WallScene.Renderer(cv, sc, L, { clear: true, keep: true });
      await R.load(); R.draw(1);
      return { kinds: L.map(l => l.kind + ':' + l.name), warn: R.warn, drop: L.filter(l => l.drop).map(l => l.name), loaded: L.filter(l => l.gtex && !l.drop).map(l => l.name),
        rain: Object.keys(R.texCache).filter(k => /^stand:/.test(k)), rainIsHalo: L.find(l => l.name === '大雨').gtex === R.texCache['particle/halo'],
        fx: (L.find(l => l.kind === 'capture') || {}).fx ? L.find(l => l.kind === 'capture').fx.length : -1 };
    }, PKG);
    ok('① projectlayer 认成全景合成层', r.kinds.includes('capture:全景合成层'), r.kinds);
    ok('① 坏贴图那层被单独跳过', r.drop.includes('坏贴图') && r.warn.some(w => /坏贴图/.test(w)), { drop: r.drop, warn: r.warn });
    ok('① 坏贴图后面的层照常加载（格式 5 的蕨、人物）', r.loaded.includes('蕨') && r.loaded.includes('人物') && r.loaded.includes('bg'), r.loaded);
    ok('① 包里没带的 WE 雨丝贴图：用细雨丝替代图，不再是圆光点', r.rain.includes('stand:rain') && !r.rainIsHalo, r.rain);
    if (hasBlur) ok('① 模糊特效（含 common_composite.h 的最后一步）编译通过', r.fx === 1 && !r.warn.some(w => /blur/.test(w)), { fx: r.fx, warn: r.warn });
    ok('① 无页面错误', !errs.length, errs); await p.close(); }
  // ② 在 App 里导入：首页照常显示，记下跳过了几处，详情里写明
  { const { p, ctx, errs } = await boot(b, { init: `(() => { let pend = ''; window.AmorNative = { wallPick() { setTimeout(() => { pend = JSON.stringify({ path: 'file://${PKG}', name: 'compat.mpkg', size: ${fs.statSync(PKG).size}, kind: 'scene' }); window.__wallIn(); }, 100); }, takeWall() { const s = pend; pend = ''; return s; }, wallDelete() { return true; } };
      if (!localStorage.getItem('cseed')) { localStorage.setItem('cseed', '1'); const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1') || '{}'); w.dyn = true; localStorage.setItem('cloud-weather-walls-v1', JSON.stringify(w)); } })()` });
    const toasts = []; await p.exposeFunction('__t', s => toasts.push(s)); await p.evaluate(() => { new MutationObserver(() => { const t = document.querySelector('.toast'); if (t) window.__t(t.textContent); }).observe(document.body, { childList: true, subtree: true, characterData: true }); });
    await p.evaluate(() => AmorNative.wallPick());
    await p.waitForFunction(() => { const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1')); const c = w.list.find(x => x.id === w.cur); return c && c.warn; }, null, { timeout: 120000 }).catch(() => {});
    const rec = await p.evaluate(() => { const w = JSON.parse(localStorage.getItem('cloud-weather-walls-v1')); return w.list.find(x => x.id === w.cur); });
    ok('② 导入后用上了这张', rec && rec.name === '兼容测试', rec && rec.name);
    ok('② 记下了跳过的地方（坏贴图）', rec && Array.isArray(rec.warn) && rec.warn.includes('坏贴图'), rec && rec.warn);
    const st = await p.evaluate(() => ({ worker: __Wall.state().worker, err: window.__wallErr || null, wk: window.__wallWkErr || null }));
    ok('② 一张贴图坏了不再把后台线程整个关掉', !st.wk && !st.err, st);
    ok('② 刚导入时提示了一句', toasts.some(t => /处暂时还原不了/.test(t)), toasts.slice(-3));
    await p.evaluate(id => { window.__goTab('settings'); }, rec.id); await p.waitForTimeout(500);
    await p.evaluate(() => { const s = document.querySelector('[data-ui="wall"]'); if (s) s.click(); }); await p.waitForTimeout(500);
    await p.evaluate(id => { const e = document.querySelector('[data-wedit="' + id + '"]'); if (e) e.click(); }, rec.id); await p.waitForTimeout(900);
    const hint = await p.evaluate(() => { const h = document.querySelector('.w-warn'); return h && h.textContent; });
    ok('② 壁纸详情里写明有几处还原不了', !!hint && /坏贴图/.test(hint), hint);
    ok('② 无页面错误', !errs.length, errs); await ctx.close(); }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
