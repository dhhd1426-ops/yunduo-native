#!/usr/bin/env bash
# 在模拟器里离屏渲染测试壁纸，截一帧拉回来（android-emulator-runner 的 script 里调用）
set -x
OUT=out/we; mkdir -p $OUT
adb shell getprop ro.build.version.sdk > $OUT/sdk.txt
adb shell cmd gpu vkjson > $OUT/vkjson.txt 2>&1 || true
adb shell rm -rf /data/local/tmp/we
adb shell mkdir -p /data/local/tmp/we/scene /data/local/tmp/we/cache
adb push build-x86_64/werender /data/local/tmp/we/ > /dev/null
adb push we/assets /data/local/tmp/we/ > /dev/null
adb push testdata/scene.pkg testdata/project.json /data/local/tmp/we/scene/ > /dev/null
adb shell chmod 755 /data/local/tmp/we/werender
# 前台跑，最长 25 分钟；日志全量拉回
timeout 1600 adb shell "cd /data/local/tmp/we && WE_CACHE=/data/local/tmp/we/cache WE_TIMEOUT=1500 ./werender assets scene/scene.json out.ppm 360 640 30" > $OUT/run.log 2>&1
echo "exit=$?" >> $OUT/run.log
adb pull /data/local/tmp/we/out.ppm $OUT/out.ppm || true
adb logcat -d -t 1500 > $OUT/logcat.txt 2>&1 || true
exit 0
