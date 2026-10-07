#!/usr/bin/env bash
# 5.18 原生壁纸专项：模拟器用 -gpu guest（合成和 Vulkan 都在模拟器里面用 SwiftShader 跑，Vulkan 画的画面截屏才看得到），
# 装测试包 → 导入测试壁纸（in the rain）→ 等原生第一帧 → 截图 → 退到后台再回来 → 截图 → 收日志
set -x
PKG=com.cloudweather.xiaoyu
O=out/guest; mkdir -p $O
A() { timeout 60 adb "$@"; }
shot() { timeout 60 adb exec-out screencap -p > "$O/$1.png"; }
note() { echo "== $(date -u +%T) $*" | tee -a $O/steps.txt; }
first() { A logcat -d -s WE:I | grep -c "first frame"; }

A install -r out/test.apk > $O/install.txt 2>&1
A shell settings put system screen_off_timeout 1800000
A shell svc power stayon true
A shell input keyevent KEYCODE_WAKEUP; A shell wm dismiss-keyguard
A logcat -c
note "launch"
A shell am start -W -n $PKG/.MainActivity > $O/start.txt
sleep 40; shot 0-launch
note "import"
timeout 120 adb exec-in "run-as $PKG sh -c 'mkdir -p files && cat > files/ci_wall.mpkg'" < testdata/scene.pkg
A shell am start -a android.intent.action.VIEW -d "file:///data/user/0/$PKG/files/ci_wall.mpkg" -n $PKG/.MainActivity
for i in $(seq 1 90); do sleep 5; if [ "$(first)" -ge 1 ]; then note "first native frame after $((i*5))s"; break; fi; done
sleep 10; shot 1-native
A shell dumpsys meminfo $PKG > $O/mem-1-native.txt 2>&1; A shell cat /proc/meminfo > $O/sysmem-1.txt
sleep 30; shot 2-native-30s
A shell dumpsys SurfaceFlinger > $O/sf.txt 2>&1
A logcat -d -s 'WE:*' 'WeWall:*' > $O/we-log.txt
A logcat -d | grep -E "\[we\]|WeWall|AndroidRuntime|FATAL" | tail -200 > $O/console.txt
note "background"
A shell input keyevent KEYCODE_HOME; sleep 10
A logcat -d -s 'WE:*' 'WeWall:*' > $O/we-log-home.txt
A shell dumpsys meminfo $PKG > $O/mem-2-home.txt 2>&1; A shell cat /proc/meminfo > $O/sysmem-2.txt
note "resume"
A shell am start -f 0x30000000 -n $PKG/.MainActivity
B() { timeout 12 adb "$@"; }
for i in $(seq 1 24); do
  sleep 5
  B shell cat /proc/meminfo 2>/dev/null | head -3 | tr '\n' ' ' >> $O/sysmem-resume.txt; echo >> $O/sysmem-resume.txt
  B logcat -d -s 'WE:*' 'WeWall:*' > $O/we-log-resume-$i.txt 2>/dev/null
  if grep -q "first frame" $O/we-log-resume-$i.txt && [ "$(grep -c 'first frame' $O/we-log-resume-$i.txt)" -ge 2 ]; then note "native frame again after $((i*5))s"; break; fi
done
sleep 10; shot 3-resumed
note "rotate to landscape (like unfolding a foldable: surface transform 90°)"
A shell settings put system accelerometer_rotation 0
A shell settings put system user_rotation 1
for i in $(seq 1 24); do sleep 5; n=$(B logcat -d -s WE:I | grep -c "first frame"); if [ "${n:-0}" -ge 3 ]; then note "native frame after rotation $((i*5))s"; break; fi; done
sleep 8; shot 4-landscape
A logcat -d -s 'WeWall:*' > $O/wewall-rotate.txt
A shell settings put system user_rotation 0
sleep 15; shot 5-portrait-again
note "settings page (blur snapshot behind)"
A shell input swipe 300 1200 300 1200 10; sleep 2
note "collect"
A logcat -d -s 'WE:*' 'WeWall:*' > $O/we-log2.txt
A logcat -d > $O/logcat-full.txt
grep -E "AndroidRuntime|FATAL|ANR in|cloudweather" $O/logcat-full.txt | head -200 > $O/logcat.txt || true
(A shell pidof $PKG || echo DEAD) > $O/pid-end.txt
exit 0
