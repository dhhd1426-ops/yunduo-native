#!/usr/bin/env bash
set -euo pipefail
mkdir -p out/check516/java
curl -fsSL https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar -o out/check516/json.jar
javac -encoding UTF-8 -cp out/check516/json.jar -d out/check516/java native/src/com/cloudweather/xiaoyu/WallPackage.java tests/native/WallPackageTest.java
java -Xmx64m -cp out/check516/java:out/check516/json.jar com.cloudweather.xiaoyu.WallPackageTest out/check516/package app/www/walls/default.mpkg > out/check516/package.log
node - <<'NODE' | tee out/check516/runtime.log
const {FramePipe,Clock,AssetPool}=require('./app/www/fonts/wall-runtime');
const sent=[]; const p=new FramePipe(x=>sent.push(x)); for(let i=0;i<200;i++)p.push({t:'draw',i});
if(sent.length!==1||!p.next||p.next.i!==199||p.coalesced!==198)process.exit(1);
const c=new Clock(); c.step(0,1); if(c.step(100,1)!==.1)process.exit(1);
const a=new AssetPool(2); Promise.all([1,2,3,4].map(i=>a.run(()=>new Promise(r=>setTimeout(r,1))))).then(()=>{if(a.peak>2||a.active)process.exit(1); console.log('PASS frame pipe, clock and bounded asset pool');});
NODE
npm install --prefix out/check516/web playwright@1.51.1
export NODE_PATH="$PWD/out/check516/web/node_modules"
./out/check516/web/node_modules/.bin/playwright install --with-deps chromium
if [ ! -e apk ]; then ln -s app apk; fi
python3 - <<'PY'
import struct,json,pathlib
f=open('app/www/walls/default.mpkg','rb')
def u():return struct.unpack('<I',f.read(4))[0]
def text():return f.read(u()).decode('utf-8')
ver=text();items=[]
for i in range(u()):items.append((text(),u(),u()))
start=f.tell();root=pathlib.Path('tests/generated-wall').resolve();root.mkdir(parents=True,exist_ok=True);files={}
for name,offset,size in items:
 p=root/name;p.parent.mkdir(parents=True,exist_ok=True);f.seek(start+offset);p.write_bytes(f.read(size));files[name]=p.as_uri()
(root/'__yunduo_manifest.json').write_text(json.dumps({'ver':ver,'files':files}))
PY
for test in fix516test citywall516test pagertest icon515test motion514test; do
 timeout 450 node "tests/$test.js" > "out/check516/$test.log" 2>&1 || { cat "out/check516/$test.log"; exit 1; }
 tail -6 "out/check516/$test.log"
 if grep -Eq '^FAIL|FAILED' "out/check516/$test.log"; then cat "out/check516/$test.log"; exit 1; fi
done
# 软件光栅器的端到端测试和原生模拟器测试共用同一构建提交。
printf 'PASS 5.16 package/runtime/browser checks\n' > out/check516/RESULT.txt
