const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const boot=require('./_boot515');
(async()=>{
 const b=await chromium.launch({args:['--allow-file-access-from-files','--disable-web-security','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  for(const noWorker of [false,true]) {
   const {p,ctx,errs}=await boot(b,{init:`window.__noWallWorker=${noWorker};const w=JSON.parse(localStorage.getItem('cloud-weather-walls-v1'));w.dyn=true;localStorage.setItem('cloud-weather-walls-v1',JSON.stringify(w));`});
   await p.click('.w-menu'); await p.waitForTimeout(1200);
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
   const imported=await p.evaluate(async()=>{
    const manifest='file://'+location.pathname.replace(/apk\/www\/index.html$/, 'tests/generated-wall/__yunduo_manifest.json');
    const event={name:'lossless.mpkg',path:manifest.replace(/\/[^/]+$/,'/original-never-read.mpkg'),pack:manifest,kind:'scene',size:600*1024*1024};
    let take=JSON.stringify(event);window.AmorNative={takeWall:()=>{let v=take;take='';return v;}};__wallIn();return event;
   });
   await p.waitForFunction(()=>{let w=JSON.parse(localStorage.getItem('cloud-weather-walls-v1'));return w.list.some(x=>x.pack)&&document.querySelector('#wall.ready');},null,{timeout:90000});
   const wall=await p.evaluate(()=>{let w=JSON.parse(localStorage.getItem('cloud-weather-walls-v1'));return w.list.find(x=>x.pack);});assert.equal(wall.size,600*1024*1024);assert.equal(wall.pack,imported.pack);
   const state=await p.evaluate(()=>__Wall.state());assert.equal(state.worker,!noWorker);assert.equal(state.err,'');assert.ok(state.framePending<=1&&state.frameQueued<=1);console.log('PASS extracted scene import and lazy URL textures: '+(noWorker?'main':'worker'));
   const quality=await p.evaluate(async()=>{
    const get=url=>new Promise((ok,no)=>{const x=new XMLHttpRequest();x.open('GET',url);x.responseType='arraybuffer';x.onload=()=>ok(x.response);x.onerror=no;x.send();});
    const packed=WallScene.unpack(await get('walls/default.mpkg'));
    const w=JSON.parse(localStorage.getItem('cloud-weather-walls-v1')).list.find(x=>x.pack);let indexed=JSON.parse(new TextDecoder().decode(await get(w.pack)));
    for(const k of Object.keys(indexed.files))if(/\.(json|vert|frag)$/i.test(k))indexed.files[k]=new Uint8Array(await get(indexed.files[k]));
    async function pixels(pkg){const c=document.createElement('canvas');c.width=256;c.height=456;const sc=new WallScene.Scene(pkg),r=new WallScene.Renderer(c,sc,sc.layers(),{clear:true,focus:[.5,.5],zoom:1});await r.load();r.draw(0);const gl=r.gl,px=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,px);r.destroy();return px;}
    const a=await pixels(packed),z=await pixels(indexed);let diff=0;for(let i=0;i<a.length;i++)if(a[i]!==z[i])diff++;return {diff,total:a.length};
   });assert.equal(quality.diff,0);console.log('PASS packed vs file-indexed rendering pixels identical '+quality.total);
   await p.evaluate(()=>__amorPause());const count=await p.evaluate(()=>__Wall.state().frameSubmitted);await p.waitForTimeout(700);assert.equal(await p.evaluate(()=>__Wall.state().frameSubmitted),count);assert.equal(await p.evaluate(()=>__Wall.state().running),false);console.log('PASS background pause stops scheduling');
   await p.evaluate(()=>__Wall.resume());await p.waitForTimeout(500);assert.equal(await p.evaluate(()=>__Wall.state().running),true);console.log('PASS resume restarts animated scene');
   assert.deepEqual(errs,[]);await ctx.close();
  }
  console.log('ALL PASS fix516');
 } finally {await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
