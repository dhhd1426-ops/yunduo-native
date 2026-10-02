// 开关统一动效：时间感知 / 启用记忆 / 聊天时自动记住新的事
const {chromium}=require('playwright');const assert=require('node:assert/strict');const boot=require('./_boot515');
const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?'  '+JSON.stringify(d):''));if(!c)process.exitCode=1;};
(async()=>{
 const b=await chromium.launch({args:['--allow-file-access-from-files','--disable-web-security']});
 try{
  for(const reduce of [false,true]){
   const tag=reduce?'[减少动态] ':'';
   const {p,errs}=await boot(b,{reduce});
   await p.click('.w-menu');await p.waitForFunction(()=>document.querySelector('#main .set-x')&&!document.querySelector('.circ'),null,{timeout:20000});await p.waitForTimeout(400);
   await p.click('[data-ui="memory"]');await p.waitForSelector('.sw2',{timeout:8000});await p.waitForTimeout(500);
   const sel='.sw2';
   const n=await p.$$eval(sel,e=>e.length);ok(tag+'三个开关都是新组件',n>=3,n);
   const kinds=await p.$$eval(sel,e=>e.map(x=>x.dataset.sw+':'+x.getAttribute('role')+':'+x.getAttribute('aria-checked')));
   ok(tag+'role=switch 且有 aria-checked',kinds.every(k=>k.split(':')[1]==='switch'&&/true|false/.test(k.split(':')[2])),kinds);
   // 找到每个 kind 的下标，保证先关的变成开
   for(const kind of ['clock','star','spark']){
     let el=p.locator('.sw2[data-sw="'+kind+'"]');
     if(kind==='spark'&&await p.locator('.sw2[data-sw="spark"]').count()===0){ // 自动记住只在启用记忆时出现
       await p.locator('.sw2[data-sw="star"]').click();await p.waitForTimeout(600);el=p.locator('.sw2[data-sw="spark"]');}
     let before=await el.getAttribute('aria-checked');
     if(before==='true'){await el.click();await p.waitForTimeout(700);before=await el.getAttribute('aria-checked');}
     ok(tag+kind+' 起始为关',before==='false');
     // 开启：采样
     await el.click();
     const samples=[];
     for(let i=0;i<14;i++){await p.waitForTimeout(30);samples.push(await p.evaluate(k=>{const e=document.querySelector('.sw2[data-sw="'+k+'"]'),kn=e.querySelector('.sw2-knob');const m=new DOMMatrix(getComputedStyle(kn).transform);return {x:m.m41,sx:m.a,anims:document.getAnimations().filter(a=>a.effect&&a.effect.target&&e.contains(a.effect.target)).length,aria:e.getAttribute('aria-checked'),fill:getComputedStyle(e.querySelector('.sw2-fill')).clipPath};},kind));}
     await p.waitForTimeout(700);
     const end=await p.evaluate(k=>{const e=document.querySelector('.sw2[data-sw="'+k+'"]'),kn=e.querySelector('.sw2-knob'),cs=getComputedStyle(e),ks=getComputedStyle(kn);return {x:new DOMMatrix(ks.transform).m41,aria:e.getAttribute('aria-checked'),knob:ks.backgroundColor,color:ks.color,border:cs.borderColor,fill:getComputedStyle(e.querySelector('.sw2-fill')).clipPath,anims:document.getAnimations().length};},kind);
     ok(tag+kind+' 开启后：aria-checked=true、滑块在右端、没有残留动画',end.aria==='true'&&Math.abs(end.x-20)<.6&&end.anims===0,end);
     ok(tag+kind+' 开启后滑块变白、轨道填主题色',end.knob==='rgb(255, 255, 255)'&&/circle\(46px/.test(end.fill),end);
     if(!reduce){
       const maxX=Math.max(...samples.map(s=>s.x));
       ok(tag+kind+' 弹簧有轻微过冲（约 8%，行程 20 → 峰值 20.8–22.5）',maxX>20.6&&maxX<22.8,+maxX.toFixed(2));
       ok(tag+kind+' 有在播的动画（滑块/洇色/光晕…）',samples.some(s=>s.anims>=3),samples.map(s=>s.anims));
       ok(tag+kind+' 轨道洇色是径向（clip-path 半径在中途连续变化）',new Set(samples.map(s=>s.fill)).size>3);
       const total=samples.findIndex(s=>s.anims===0);
     } else {
       ok(tag+kind+' 减少动态：没有任何位移/洇色/光晕动画',samples.every(s=>s.anims===0),samples.map(s=>s.anims));
     }
     // 关闭
     await el.click();await p.waitForTimeout(900);
     const off=await p.evaluate(k=>{const e=document.querySelector('.sw2[data-sw="'+k+'"]'),kn=e.querySelector('.sw2-knob');return {aria:e.getAttribute('aria-checked'),x:new DOMMatrix(getComputedStyle(kn).transform).m41,fill:getComputedStyle(e.querySelector('.sw2-fill')).clipPath,knob:getComputedStyle(kn).backgroundColor};},kind);
     ok(tag+kind+' 关闭后回到左端、轨道收回、滑块灰蓝',off.aria==='false'&&Math.abs(off.x)<.6&&/circle\(0px/.test(off.fill)&&off.knob==='rgb(129, 151, 176)',off);
   }
   if(!reduce){
     // 光晕只在开启时播；ripple 只有 star；时钟指针转一圈
     const probe=async(kind,turnOn)=>{const el=p.locator('.sw2[data-sw="'+kind+'"]');const cur=await el.getAttribute('aria-checked');if((cur==='true')!==!turnOn){await el.click();await p.waitForTimeout(800);}
       await el.click();await p.waitForTimeout(60);return p.evaluate(k=>{const e=document.querySelector('.sw2[data-sw="'+k+'"]');const A=document.getAnimations().filter(a=>a.effect&&a.effect.target&&e.contains(a.effect.target));const cls=a=>a.effect.target.className&&a.effect.target.className.baseVal!==undefined?a.effect.target.className.baseVal:a.effect.target.className;return A.map(a=>cls(a)+'|'+(a.effect.getKeyframes()[0].boxShadow?'shadow':a.effect.getKeyframes()[0].transform||a.effect.getKeyframes()[0].clipPath||'')).join(';');},kind);};
     const on1=await probe('clock',true);ok('时钟：开启时有光晕、洇色和指针旋转',/sw2-glow\|shadow/.test(on1)&&/hand\|rotate\(-360deg\)/.test(on1)&&/sw2-fill/.test(on1),on1);
     const off1=await probe('clock',false);ok('时钟：关闭时不播光晕',!/sw2-glow/.test(off1)&&/sw2-fill/.test(off1),off1);
     const on2=await probe('star',true);ok('启用记忆：开启时有涟漪',/sw2-rip\|translateX\(20px\) scale\(0\.6\)/.test(on2),on2);
     const on3=await probe('spark',true);ok('自动记住：✦ 先放大再落回',/\|scale\(0\.3\)/.test(on3),on3);
     await p.waitForTimeout(800);
     // 看不见就停
     await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
     await p.waitForTimeout(100);
     ok('页面不可见：动画被收尾',await p.evaluate(()=>document.getAnimations().filter(a=>a.effect&&a.effect.target&&a.effect.target.closest&&a.effect.target.closest('.sw2')).length)===0);
   }
   ok(tag+'无页面错误',errs.length===0,errs);
   await p.close();
  }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
