// 5.16 起的回归：设置页不整页重画、聊天图片多选 / 取消重试；5.19 壁纸只剩图片和视频：.mpkg 导入被拒、图片导入、旧的场景壁纸显示预览图、暂停恢复
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const boot=require('./_boot515');
// 以前导入的场景壁纸：App 目录里留着解包目录和清单（这里用自带缩略图当预览图）
const legacy=path.resolve('tests/generated-wall');fs.mkdirSync(legacy,{recursive:true});
fs.copyFileSync('apk/www/walls/default-thumb.jpg',path.join(legacy,'preview.jpg'));
fs.writeFileSync(path.join(legacy,'__yunduo_manifest.json'),JSON.stringify({ver:'PKGM0016',files:{'preview.jpg':'file://'+path.join(legacy,'preview.jpg'),'scene.json':'file://'+path.join(legacy,'scene.json')}}));
const thumbUrl='file://'+path.resolve('apk/www/walls/default-thumb.jpg');
(async()=>{
 const b=await chromium.launch({args:['--allow-file-access-from-files','--disable-web-security']});
 try {
  const {p,ctx,errs}=await boot(b,{init:`const w=JSON.parse(localStorage.getItem('cloud-weather-walls-v1'));w.dyn=true;localStorage.setItem('cloud-weather-walls-v1',JSON.stringify(w));`});
  await p.click('.w-menu'); await p.waitForFunction(()=>document.querySelector('#main .set-x')&&!document.querySelector('.circ'),null,{timeout:20000}); await p.waitForTimeout(300);
  await p.evaluate(()=>{window.__settingsView=document.querySelector('#main .view');window.__mainReplacements=0;window.__mainObserver=new MutationObserver(ms=>{for(const m of ms)for(const n of m.removedNodes)if(n===window.__settingsView)window.__mainReplacements++;});__mainObserver.observe(document.querySelector('#main'),{childList:true,subtree:true});document.dispatchEvent(new Event('visibilitychange'));});
  await p.waitForTimeout(1600);assert.equal(await p.evaluate(()=>__mainReplacements),0);console.log('PASS settings stays mounted after weather/visibility refresh');
  await p.evaluate(()=>history.back());await p.waitForTimeout(1000);
  await p.click('.dk-in');await p.waitForTimeout(900);
  async function choose(){await p.click('[data-tool="plus"]');await p.waitForTimeout(400);const [fc]=await Promise.all([p.waitForEvent('filechooser',{timeout:5000}),p.click('[data-plus="img"]')]);assert.equal(fc.isMultiple(),true);return fc;}
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=','base64');
  let fc=await choose();await fc.setFiles([{name:'1.png',mimeType:'image/png',buffer:png},{name:'2.png',mimeType:'image/png',buffer:png}]);await p.waitForFunction(()=>document.querySelectorAll('.att-row .att').length===2);
  console.log('PASS image picker opens immediately and two selected images attach');
  fc=await choose();await fc.setFiles([]);await p.waitForTimeout(300);
  fc=await choose();await fc.setFiles(Array.from({length:3},(_,i)=>({name:'next'+i+'.png',mimeType:'image/png',buffer:png})));await p.waitForFunction(()=>document.querySelectorAll('.att-row .att').length===4);
  console.log('PASS cancelled selection can retry; four-image limit retained');
  await p.evaluate(()=>history.back());await p.waitForTimeout(900);
  // 自带壁纸是一张静态图
  const st0=await p.evaluate(()=>__Wall.state());assert.equal(st0.id,'builtin');assert.equal(st0.kind,'img');assert.match(st0.src,/walls\/default\.webp$/);
  console.log('PASS builtin wallpaper is the baked still image');
  // .mpkg 不再支持：拒绝、提示、列表不变、复制进来的文件删掉
  const rej=await p.evaluate(async()=>{const del=[];let take=JSON.stringify({name:'x.mpkg',path:'file:///tmp/x.mpkg',pack:'file:///tmp/x.mpkg.assets/__yunduo_manifest.json',kind:'scene',size:9});
   window.AmorNative={takeWall:()=>{let v=take;take='';return v;},wallDelete:p=>{del.push(p);return true;}};__wallIn();await new Promise(r=>setTimeout(r,300));
   return {n:JSON.parse(localStorage.getItem('cloud-weather-walls-v1')).list.length,toast:(document.querySelector('.toast')||{}).textContent||'',del};});
  assert.equal(rej.n,1);assert.match(rej.toast,/不再支持/);assert.deepEqual(rej.del,['file:///tmp/x.mpkg']);console.log('PASS .mpkg import is refused with a message');
  // 图片导入
  await p.evaluate(async(u)=>{let take=JSON.stringify({name:'photo.jpg',path:u,kind:'image',size:16000});window.AmorNative={takeWall:()=>{let v=take;take='';return v;}};__wallIn();},thumbUrl);
  await p.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('cloud-weather-walls-v1'));return w.cur!=='builtin'&&__Wall.state().id===w.cur&&document.querySelector('#wall.ready');},null,{timeout:20000});
  const im=await p.evaluate(()=>({st:__Wall.state(),w:JSON.parse(localStorage.getItem('cloud-weather-walls-v1')).list[0]}));assert.equal(im.st.kind,'img');assert.equal(im.w.kind,'image');assert.equal(im.w.name,'photo');assert.ok(im.w.thumb.startsWith('data:image/jpeg'));
  console.log('PASS image import becomes the current wallpaper');
  assert.deepEqual(errs,[]);await ctx.close();
  // 以前导入的场景壁纸：显示包里的预览图，详情里说明
  const man='file://'+path.join(legacy,'__yunduo_manifest.json');
  const r2=await boot(b,{init:`const w=JSON.parse(localStorage.getItem('cloud-weather-walls-v1'));w.dyn=true;w.list=[{id:'old1',name:'旧场景',kind:'scene',path:'file:///x/old.mpkg',pack:${JSON.stringify(man)},thumb:'',focus:[.5,.5],zoom:1,align:'auto',tags:[],at:1,pdef:[{key:'a',type:'bool',value:true}]}];w.cur='old1';localStorage.setItem('cloud-weather-walls-v1',JSON.stringify(w));`});
  await r2.p.waitForFunction(()=>__Wall.state().id==='old1'&&document.querySelector('#wall.ready'),null,{timeout:20000});
  const lg=await r2.p.evaluate(()=>__Wall.state());assert.equal(lg.kind,'img');assert.match(lg.src,/generated-wall\/preview\.jpg$/);assert.equal(lg.still,true);
  console.log('PASS legacy scene wallpaper shows its package preview');
  // 下雨：雨水在动；切后台停、回来接着动
  await r2.p.evaluate(()=>{window.__rainForce=true;__Wall.sync();});await r2.p.waitForTimeout(600);
  assert.equal((await r2.p.evaluate(()=>__Wall.state())).running,true);
  await r2.p.evaluate(()=>__amorPause());await r2.p.waitForTimeout(300);assert.equal((await r2.p.evaluate(()=>__Wall.state())).running,false);console.log('PASS background pause stops the rain loop');
  await r2.p.evaluate(()=>__Wall.resume());await r2.p.waitForTimeout(400);assert.equal((await r2.p.evaluate(()=>__Wall.state())).running,true);console.log('PASS resume restarts the rain loop');
  assert.deepEqual(r2.errs,[]);await r2.ctx.close();
  console.log('ALL PASS fix516');
 } finally {await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
