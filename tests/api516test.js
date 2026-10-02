// API 设置页：测试连接 / 保存 / 刷新 三个控件的动效与状态机
const {chromium}=require('playwright');const boot=require('./_boot515');
const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?'  '+JSON.stringify(d):''));if(!c)process.exitCode=1;};
(async()=>{
 const b=await chromium.launch({args:['--allow-file-access-from-files','--disable-web-security']});
 try{
  for(const reduce of [false,true]){
   const tag=reduce?'[减少动态] ':'';
   const {p,errs,ctl}=await boot(b,{reduce});
   await p.click('.w-menu');await p.waitForFunction(()=>document.querySelector('#main .set-x')&&!document.querySelector('.circ'),null,{timeout:20000});await p.waitForTimeout(300);
   await p.evaluate(()=>document.querySelector('[data-ui="providers"]').click());await p.waitForTimeout(500);
   await p.evaluate(()=>document.querySelector('[data-openprov="deepseek"]').click());await p.waitForSelector('.ap-test',{timeout:8000});await p.waitForTimeout(400);
   const S=(sel)=>p.evaluate(s=>{const e=document.querySelector(s);return e?{cls:e.className,txt:e.textContent.trim(),an:e.getAnimations({subtree:true}).length}:null},sel);
   /* ---- 保存 ---- */
   let sv=await S('.ap-save');ok(tag+'保存：无改动是灰态、aria-disabled',/ph-clean/.test(sv.cls)&&await p.getAttribute('.ap-save','aria-disabled')==='true',sv);
   const cs0=await p.evaluate(()=>{const c=getComputedStyle(document.querySelector('.ap-save'));return [c.backgroundColor,c.color]});
   await p.click('.ap-save',{force:true});await p.waitForTimeout(150);ok(tag+'保存：灰态点击无反应',/ph-clean/.test((await S('.ap-save')).cls));
   await p.fill('#p-name','DeepSeek 改');await p.waitForTimeout(60);
   sv=await S('.ap-save');ok(tag+'保存：改了名字 → 亮起',/ph-dirty/.test(sv.cls),sv);
   if(!reduce)ok(tag+'保存：第一次亮起弹一下（有 scale 动画）',sv.an>=1,sv.an);
   await p.waitForTimeout(450);
   const cs1=await p.evaluate(()=>{const c=getComputedStyle(document.querySelector('.ap-save'));return [c.backgroundColor,c.color]});
   ok(tag+'保存：灰态与可点击态对比明显',cs0[0]!==cs1[0]&&cs0[1]!==cs1[1]&&cs1[0]==='rgb(246, 239, 223)',[cs0,cs1]);
   await p.click('.ap-save');
   if(!reduce){
     const tl=[];for(let i=0;i<12;i++){await p.waitForTimeout(45);tl.push(await p.evaluate(()=>{const e=document.querySelector('.ap-save');return {t:performance.now()|0,m:getComputedStyle(e).transform,cls:e.className.match(/ph-\w+/)[0],txt:e.querySelector('.ap-sv-tx').textContent,ck:getComputedStyle(e.querySelector('.ap-sv-ck')).opacity}}));}
     ok(tag+'保存：翻折（transform 含 3D 旋转）并在约 250ms 后换 ✓',tl.some(x=>/matrix3d/.test(x.m))&&tl.some(x=>x.cls==='ph-saved'),tl.map(x=>x.cls+':'+(x.m==='none'?'-':'3d')).join(' '));
   }
   await p.waitForTimeout(500);
   sv=await S('.ap-save');ok(tag+'保存：已保存显示 ✓',/ph-saved/.test(sv.cls),sv);
   const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('cloud-weather-providers')||localStorage.getItem(Object.keys(localStorage).find(k=>/provider/i.test(k))||'')||'[]'));
   ok(tag+'保存：真的写进了存储',JSON.stringify(stored).includes('DeepSeek 改'));
   await p.waitForTimeout(1600);sv=await S('.ap-save');ok(tag+'保存：约 1.4s 后回到「保存」灰态',/ph-clean/.test(sv.cls)&&sv.txt==='保存',sv);
   // 保存失败
   await p.fill('#p-name','DeepSeek 再改');await p.waitForTimeout(500);
   await p.evaluate(()=>{window.__sI=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(/provider/i.test(k))throw new Error('quota');return window.__sI.apply(this,arguments)}});
   await p.click('.ap-save');await p.waitForTimeout(200);sv=await S('.ap-save');
   ok(tag+'保存失败：不翻折，泛红，文字「保存失败」',/ph-fail/.test(sv.cls)&&sv.txt==='保存失败',sv);
   await p.evaluate(()=>{Storage.prototype.setItem=window.__sI});
   await p.waitForTimeout(1900);sv=await S('.ap-save');ok(tag+'保存失败：1.5s 后恢复，仍是「有改动」',/ph-dirty/.test(sv.cls)&&sv.txt==='保存',sv);
   /* ---- 测试连接 ---- */
   ctl.chatFail=true;const c0=ctl.chatCalls;
   await p.click('.ap-test');await p.waitForTimeout(250);
   let t=await S('.ap-test');ok(tag+'测试：连接中文字',/ph-load/.test(t.cls)&&t.txt==='连接中…',t);
   if(!reduce)ok(tag+'测试：连接中有循环动画（图标轻推 + 光带）',t.an>=2,t.an);else ok(tag+'测试：减少动态下没有动画',t.an===0,t.an);
   await p.click('.ap-test',{force:true});await p.waitForTimeout(100);ok(tag+'测试：连接中重复点击被忽略',ctl.chatCalls-c0<=1,ctl.chatCalls-c0);
   await p.waitForFunction(()=>/ph-err/.test(document.querySelector('.ap-test').className),null,{timeout:8000});
   t=await S('.ap-test');ok(tag+'测试：失败文字「连接失败 · 原因」',/^连接失败 · .+/.test(t.txt),t.txt);
   if(!reduce){await p.waitForTimeout(80);ok(tag+'测试：失败时有抖动动画、光带已停',(await S('.ap-test')).an>=1&&await p.evaluate(()=>getComputedStyle(document.querySelector('.ap-band')).opacity)==='0');}
   await p.waitForTimeout(2500);t=await S('.ap-test');ok(tag+'测试：2.2s 后回到空闲',/ph-idle/.test(t.cls)&&t.txt==='测试连接',t);
   ctl.chatFail=false;await p.click('.ap-test');
   await p.waitForFunction(()=>/ph-ok/.test(document.querySelector('.ap-test').className),null,{timeout:8000});
   t=await S('.ap-test');ok(tag+'测试：成功文字「连接成功 · N ms」',/^连接成功 · \d+ ms$/.test(t.txt),t.txt);
   if(!reduce){await p.waitForTimeout(60);ok(tag+'测试：成功时图标落下（有动画）',(await S('.ap-test')).an>=1);}
   const bg=await p.evaluate(()=>{const e=document.querySelector('.ap-test'),c=getComputedStyle(e,'::before');return {o:c.opacity,bg:c.backgroundColor}});
   await p.waitForTimeout(500);ok(tag+'测试：成功背景泛绿（35%）',(await p.evaluate(()=>getComputedStyle(document.querySelector('.ap-test'),'::before').opacity))==='0.35');
   await p.waitForTimeout(2300);ok(tag+'测试：成功后 2.2s 恢复空闲',/ph-idle/.test((await S('.ap-test')).cls));
   /* ---- 刷新 ---- */
   if(await p.locator('.ap-rf').count()){
     await p.fill('#p-name','DeepSeek');await p.waitForTimeout(200);
     await p.click('.ap-rf');await p.waitForTimeout(120);
     const r1=await p.evaluate(()=>({run:ApiMo.refresh.busy('bal:deepseek'),an:document.querySelector('.ap-rf').getAnimations().length}));
     ok(tag+'刷新：点击后进入动画/请求中',reduce?r1.an===0:r1.run,r1);
     const n1=await p.evaluate(()=>{document.querySelector('.ap-rf').click();return document.querySelector('.ap-rf').getAnimations().length});
     ok(tag+'刷新：进行中重复点击被忽略',n1<=r1.an+0);
     await p.waitForFunction(()=>!ApiMo.refresh.busy('bal:deepseek'),null,{timeout:10000});
     ok(tag+'刷新：结束后没有残留动画',await p.evaluate(()=>document.querySelector('.ap-rf')?document.querySelector('.ap-rf').getAnimations().length===0:true));
   }
   ok(tag+'无页面错误',errs.length===0,errs);
   await p.close();
  }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
