// 换动态壁纸后来回换城市：壁纸不能变回别的
const {chromium}=require('playwright');const assert=require('node:assert/strict');const boot=require('./_boot515');
(async()=>{
 const b=await chromium.launch({args:['--allow-file-access-from-files','--disable-web-security','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  for(const tagged of [false,true]){
   const {p,ctx,errs}=await boot(b,{init:`const w=JSON.parse(localStorage.getItem('cloud-weather-walls-v1'));w.dyn=true;${tagged?"w.list=[{id:'builtin',tags:['sun','cloud','rain','snow','fog','night'],focus:[.5,.5],zoom:1,align:'auto',at:0}];":''}localStorage.setItem('cloud-weather-walls-v1',JSON.stringify(w));const a=JSON.parse(localStorage.getItem('cloud-weather-app-v2'));a.cities=['hz','sh','bj','cc','ls','hrb','gz','sy'];localStorage.setItem('cloud-weather-app-v2',JSON.stringify(a));`});
   await p.waitForTimeout(500);
   const id=await p.evaluate(async(tagged)=>{
    const manifest='file://'+location.pathname.replace(/apk\/www\/index.html$/, 'tests/generated-wall/__yunduo_manifest.json');
    let take=JSON.stringify({name:'new.mpkg',path:manifest.replace(/\/[^/]+$/,'/x.mpkg'),pack:manifest,kind:'scene',size:1000});window.AmorNative={takeWall:()=>{let v=take;take='';return v;}};__wallIn();
    await new Promise(r=>setTimeout(r,2500));
    const w=JSON.parse(localStorage.getItem('cloud-weather-walls-v1'));return w.cur;
   },tagged);
   await p.waitForFunction(()=>document.querySelector('#wall.ready'),null,{timeout:90000});
   assert.notEqual(id,'builtin');
   const cur=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('cloud-weather-walls-v1')).cur);
   const cdp=await ctx.newCDPSession(p);
   async function swipe(x0,y,dx,steps=12){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y}]});for(let i=1;i<=steps;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+dx*i/steps,y:y+i*.3}]});await p.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(900);}
   await swipe(100,520,220);
   const chips=await p.$$eval('[data-wxpl]',e=>e.map(x=>x.getAttribute('data-wxpl')));assert.ok(chips.length>=6,'need cities');
   const hist=[];
   for(let i=0;i<12;i++){
     await p.click('[data-wxpl="'+chips[(i*3+1)%chips.length]+'"]');await p.waitForTimeout(1200);
     hist.push([await cur(),await p.evaluate(()=>__Wall.state().id),await p.evaluate(()=>JSON.parse(localStorage.getItem('cloud-weather-walls-v1')).wxKey)]);
   }
   console.log('tagged',tagged,'new wall',id,JSON.stringify(hist));
   assert.ok(hist.every(h=>h[0]===id&&h[1]===id),'wallpaper changed after switching cities');
   console.log('tagged',tagged,'cur after import',await cur());
   await p.close();await ctx.close();
  }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
