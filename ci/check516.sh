#!/usr/bin/env bash
set -euo pipefail
# 5.17.3 Kv（聊天记录存成 App 文件）：普通 JVM 上测核心逻辑，Context 用一个空壳
mkdir -p out/check516/kv/stub/android/content out/check516/kv/out
echo 'package android.content; public abstract class Context { public abstract java.io.File getFilesDir(); }' > out/check516/kv/stub/android/content/Context.java
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -d out/check516/kv/out out/check516/kv/stub/android/content/Context.java native/src/com/cloudweather/xiaoyu/Kv.java tests/native/KvTest.java
java -Dstdout.encoding=UTF-8 -cp out/check516/kv/out com.cloudweather.xiaoyu.KvTest | tee out/check516/kv.log
npm install --prefix out/check516/web playwright@1.51.1
export NODE_PATH="$PWD/out/check516/web/node_modules"
./out/check516/web/node_modules/.bin/playwright install --with-deps chromium
if [ ! -e apk ]; then ln -s app apk; fi
for test in fix516test citywall516test sw516test api516test pagertest icon515test motion514test ; do
 timeout 450 node "tests/$test.js" > "out/check516/$test.log" 2>&1 || { cat "out/check516/$test.log"; exit 1; }
 tail -6 "out/check516/$test.log"
 if grep -Eq '^FAIL|FAILED' "out/check516/$test.log"; then cat "out/check516/$test.log"; exit 1; fi
done
printf 'PASS kv/browser checks\n' > out/check516/RESULT.txt
