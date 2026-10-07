#!/usr/bin/env bash
# 在安卓模拟器上真跑：安装调试包 → 启动 → 排两条提醒 → 等它们到点 → 截图通知栏/横幅/锁屏 → 测按钮、用眼、从通知打开
set -x
PKG=com.cloudweather.xiaoyu
RCV="$PKG/.AmorReceiver"
O=out/emu; mkdir -p $O
shot() { adb exec-out screencap -p > "$O/$1.png"; }
b64() { printf '%s' "$1" | base64 -w0; }
T() { adb shell am broadcast -a $PKG.TEST -n $RCV "$@"; }
note() { echo "== $*" | tee -a $O/steps.txt; }

adb install -r out/test.apk 2>&1 | tee $O/install.txt
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
adb shell settings put system screen_off_timeout 1800000
adb shell svc power stayon true
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard
adb logcat -c

note "1 launch"
adb shell am start -W -n $PKG/.MainActivity | tee $O/start.txt
sleep 25
(adb shell pidof $PKG || echo DEAD) > $O/pid-after-launch.txt
shot 1-launch
# 网页启动后应该已经通过 AmorNative 交来了配置和 7 天计划
adb shell run-as $PKG cat shared_prefs/amor.xml > $O/prefs-after-launch.xml 2>&1 || true
adb shell dumpsys alarm | grep -B2 -A6 "$PKG" > $O/alarm-after-launch.txt || true
adb shell cmd notification allow_listener com.android.shell 2>/dev/null || true

note "2 config + plan (two reminders in 20s / 35s)"
adb exec-in "run-as $PKG sh -c 'mkdir -p files && cat > files/ci_cfg.json'" < ci/cfg.json
adb shell "run-as $PKG ls -la files" | tee $O/files.txt
T --es cfgFile ci_cfg.json
PLAN='[{"id":101,"dt":20,"ch":"care","kind":"water","title":"喝杯水吧","short":"下午三点啦，小口慢慢喝","text":"下午三点啦，小口慢慢喝～今天有点干燥，多喝两口。","meta":"3 / 6","progress":50,"actions":["done","snooze","chat"],"doneLabel":"喝了","snoozeLabel":"30 分钟后"},{"id":102,"dt":35,"ch":"weather","kind":"morning","title":"早安，小宇","short":"晴 · 带件薄外套","text":"今天北京晴，15~26°C，早晚凉、中午暖。出门带件薄外套，中午可以脱。","meta":"15–26°","actions":["chat"]}]'
T --es plan64 "$(b64 "$PLAN")"
adb shell dumpsys alarm | grep -B2 -A6 "$PKG" > $O/alarm-after-plan.txt || true
sleep 19
for k in 1 2 3 4 5 6; do shot 2-headsup-$k; sleep 0.5; done
sleep 12; shot 3-after-morning
adb shell dumpsys notification --noredact > $O/notif-after-plan.txt
adb shell cmd statusbar expand-notifications; sleep 3; shot 4-shade
# 点开“喝杯水吧”那条的展开箭头，看展开样式（位置从界面树里找，找不到就点第二条通知的右侧）
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > $O/ui-shade.xml
XY=$(python3 - "$O/ui-shade.xml" <<'PY'
import re,sys
x=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
nodes=re.findall(r'<node [^>]*>',x)
for i,n in enumerate(nodes):
    if 'text="喝杯水吧"' in n:
        b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n); y=(int(b.group(2))+int(b.group(4)))//2
        for m in nodes[i:i+40]:
            if 'expand_button' in m or 'content-desc="Expand' in m:
                c=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',m); print((int(c.group(1))+int(c.group(3)))//2,(int(c.group(2))+int(c.group(4)))//2); sys.exit()
        print(9999,y); sys.exit()
PY
)
echo "expand at $XY" >> $O/steps.txt
set -- $XY; if [ "${1:-9999}" = 9999 ]; then adb shell input tap 280 ${2:-340}; else adb shell input tap $1 $2; fi
sleep 2; shot 4b-expanded
adb shell cmd statusbar collapse; sleep 1

note "3 DONE button on 101"
adb shell am broadcast -a $PKG.DONE -n $RCV --ei id 101
sleep 2; adb shell dumpsys notification --noredact > $O/notif-after-done.txt

note "4 SNOOZE with 0 min → fires again ~1s later"
adb shell "am broadcast -a $PKG.SNOOZE -n $RCV --ei id 102 --es amor_item '{\"id\":103,\"ch\":\"amor\",\"kind\":\"miss\",\"title\":\"Amor\",\"text\":\"snooze test\",\"snoozeMin\":0}'"
sleep 12; adb shell dumpsys notification --noredact > $O/notif-after-snooze.txt

note "5 eye: screen in use for 60 min → tick → reminder"
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard
T --ei eyeStart 60 --ez eye true
sleep 2; shot 5-eye; adb shell dumpsys notification --noredact > $O/notif-after-eye.txt

note "5b Amor-set reminder in 8s while app is in foreground (skipFg=false)"
adb shell am start -f 0x30000000 -n $PKG/.MainActivity; sleep 2
RPLAN='[{"id":71234,"dt":8,"ch":"amor","kind":"remind","title":"喝杯水吧","short":"说好的，10 秒到啦","text":"说好的，10 秒到啦～去倒杯水吧 💧","meta":"14:17","actions":["done","snooze","chat"],"doneLabel":"好的","snoozeLabel":"10 分钟后","snoozeMin":10,"skipFg":false}]'
T --es plan64 "$(b64 "$RPLAN")"
sleep 9; shot 5b-remind; sleep 1; shot 5c-remind
adb shell dumpsys notification --noredact | grep -A3 "id=71234" > $O/notif-remind.txt || true

note "6 lock screen with notifications"
adb shell locksettings set-pin 1234 || true
adb shell input keyevent KEYCODE_POWER; sleep 3
adb shell input keyevent KEYCODE_WAKEUP; sleep 3; shot 6-lockscreen
adb shell locksettings clear --old 1234 || true
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard; sleep 2

note "7a open from notification while app is running (NEW_TASK|SINGLE_TOP, like the real PendingIntent)"
adb shell "am start -f 0x30000000 -n $PKG/.MainActivity --es amor_item '{\"id\":101,\"kind\":\"water\",\"title\":\"Amor\",\"text\":\"warm open test\"}'"
sleep 4; shot 7a-opened-warm
adb shell input keyevent KEYCODE_BACK; sleep 2

note "7b open from notification when app was killed (cold start, splash plays first)"
adb shell am force-stop $PKG; sleep 2
adb shell "am start -f 0x30000000 -n $PKG/.MainActivity --es amor_item '{\"id\":102,\"kind\":\"morning\",\"title\":\"morning title\",\"text\":\"cold open test\"}'"
sleep 3; shot 7b-cold-3s
sleep 9; shot 7b-cold-12s
(adb shell pidof $PKG || echo DEAD) > $O/pid-after-cold.txt

note "7c keep-alive service"
adb shell dumpsys activity services $PKG > $O/services.txt 2>&1 || true
adb shell dumpsys notification --noredact | grep -A3 "id=7 " > $O/keep-notif.txt 2>&1 || true
adb shell input keyevent KEYCODE_HOME; sleep 1
adb shell cmd statusbar expand-notifications; sleep 3; shot 7c-keep-shade
adb shell cmd statusbar collapse; sleep 1

note "9 alarm: setAlarmClock + ring on the lock screen + snooze + ring while in use + dismiss"
AL='[{"id":4101,"dt":120,"days":[],"date":"","on":true,"label":"上班","snooze":10,"ramp":true,"text":"早安，小宇。北京多云，16~23°。今天 10:00 有「面试」，你已经准备得很好了，慢慢来。","title":"上班","name":"Amor","city":"北京"},{"id":4102,"h":7,"m":30,"days":[1,2,3,4,5],"date":"","on":true,"label":"","snooze":10,"ramp":true,"text":"早安","title":"闹钟","name":"Amor","city":"北京"}]'
T --es alarms64 "$(b64 "$AL")"
sleep 2
adb shell dumpsys alarm > $O/alarm-clock-full.txt
grep -iE "nextAlarmClock|AlarmClockInfo|alarm_clock|ALARM\b" $O/alarm-clock-full.txt | head -40 > $O/alarm-clock.txt || true
grep -B3 -A8 "com.cloudweather.xiaoyu.ALARM" $O/alarm-clock-full.txt | head -60 >> $O/alarm-clock.txt || true
adb shell locksettings set-pin 1234 || true
adb shell input keyevent KEYCODE_HOME; sleep 1
adb shell input keyevent KEYCODE_POWER; sleep 3
T --ei alarmFire 4101
sleep 7; shot 9a-ring-locked
adb shell dumpsys activity activities | grep -iE "RingActivity|topResumed|mResumed" | head -8 > $O/ring-activity.txt || true
adb shell dumpsys notification --noredact | grep -B1 -A4 "id=8 " > $O/ring-notif.txt || true
adb shell dumpsys audio | grep -iE "usage=USAGE_ALARM|AudioPlaybackConfiguration" | head -10 > $O/ring-audio.txt || true
T --ez ringSnooze true; sleep 3; shot 9b-after-snooze
adb shell dumpsys alarm | grep -B2 -A6 "ALARM" | grep -E "when|com.cloudweather" | head -20 > $O/alarm-after-snooze.txt || true
adb shell locksettings clear --old 1234 || true
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard; sleep 2
adb shell am start -f 0x30000000 -n $PKG/.MainActivity; sleep 4
T --es alarms64 "$(b64 "$AL")"
sleep 1
T --ei alarmFire 4102
sleep 5; shot 9c-ring-inuse
adb shell wm size > $O/wm-size.txt
read W H < <(adb shell wm size | tail -1 | sed 's/.*: //; s/x/ /')
adb shell input swipe $((W*17/100)) $((H*925/1000)) $((W*90/100)) $((H*925/1000)) 600 || true
sleep 3; shot 9d-after-slide
T --ez ringOff true; sleep 2; shot 9e-after-off
adb shell dumpsys notification --noredact | grep -c "id=8 " > $O/ring-notif-after-off.txt || true

note "10 viz: Visualizer on the global output (wallpaper follows the music)"
adb shell pm grant $PKG android.permission.RECORD_AUDIO || true
T --ez viz true; sleep 4
adb shell run-as $PKG cat shared_prefs/amor.xml | grep -o "viz[^&]*" | head -5 > $O/viz.txt 2>&1 || true

note "11 native Wallpaper Engine renderer (5.18): import the test .mpkg, wait for the first native frame"
if [ -f testdata/scene.pkg ]; then
  adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard
  adb shell am start -f 0x30000000 -n $PKG/.MainActivity; sleep 3
  adb exec-in "run-as $PKG sh -c 'mkdir -p files && cat > files/ci_wall.mpkg'" < testdata/scene.pkg
  adb logcat -c
  adb shell am start -a android.intent.action.VIEW -d "file:///data/user/0/$PKG/files/ci_wall.mpkg" -n $PKG/.MainActivity
  for i in $(seq 1 60); do
    sleep 5
    if adb logcat -d -s WE:I | grep -q "first frame"; then echo "first native frame after $((i*5))s" | tee -a $O/steps.txt; break; fi
  done
  sleep 8; shot 11-native-wall
  adb logcat -d -s WE:* > $O/we-log.txt
  adb shell "run-as $PKG ls -la files/amor/walls" > $O/we-walls.txt 2>&1 || true
  adb shell input keyevent KEYCODE_HOME; sleep 3
  adb shell am start -f 0x30000000 -n $PKG/.MainActivity
  for i in $(seq 1 40); do sleep 5; if adb logcat -d -s WE:I | grep -c "first frame" | grep -q "^[2-9]"; then echo "native frame again after resume $((i*5))s" | tee -a $O/steps.txt; break; fi; done
  sleep 5; shot 11b-native-resumed
  adb logcat -d -s WE:* > $O/we-log2.txt
fi

note "8 collect"
(adb shell pidof $PKG || echo DEAD) > $O/pid-end.txt
adb shell run-as $PKG cat shared_prefs/amor.xml > $O/prefs.xml 2>&1 || true
adb shell dumpsys alarm | grep -B2 -A6 "$PKG" > $O/alarm-end.txt || true
adb logcat -d > $O/logcat-full.txt
grep -E "AndroidRuntime|FATAL|VerifyError|NoSuchMethod|ClassNotFound|cloudweather|chromium.*Uncaught" $O/logcat-full.txt | head -300 > $O/logcat.txt || true
exit 0
