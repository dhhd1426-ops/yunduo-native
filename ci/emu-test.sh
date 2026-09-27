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
adb shell cmd notification allow_listener com.android.shell 2>/dev/null || true

note "2 config + plan (two reminders in 20s / 35s)"
adb exec-in run-as $PKG sh -c 'mkdir -p files && cat > files/ci_cfg.json' < ci/cfg.json
T --es cfgFile ci_cfg.json
PLAN='[{"id":101,"dt":20,"ch":"care","kind":"water","title":"Amor","text":"下午三点啦，起来喝杯水吧 💧 今天北京 26°，有点干燥，多喝两口。","actions":["done","snooze","chat"],"doneLabel":"喝了","snoozeLabel":"30 分钟后"},{"id":102,"dt":35,"ch":"weather","kind":"morning","title":"早安，小宇","text":"今天北京晴，15~26°C，早晚凉、中午暖。出门带件薄外套，中午可以脱。","actions":["chat"]}]'
T --es plan64 "$(b64 "$PLAN")"
adb shell dumpsys alarm | grep -B2 -A6 "$PKG" > $O/alarm-after-plan.txt || true
sleep 21; shot 2-headsup-water
sleep 16; shot 3-headsup-morning
adb shell dumpsys notification --noredact > $O/notif-after-plan.txt
adb shell cmd statusbar expand-notifications; sleep 3; shot 4-shade; adb shell cmd statusbar collapse; sleep 1

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

note "6 lock screen with notifications"
adb shell locksettings set-pin 1234 || true
adb shell input keyevent KEYCODE_POWER; sleep 3
adb shell input keyevent KEYCODE_WAKEUP; sleep 3; shot 6-lockscreen
adb shell locksettings clear --old 1234 || true
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard; sleep 2

note "7 open from notification (intent extra)"
adb shell "am start -n $PKG/.MainActivity --es amor_item '{\"id\":101,\"kind\":\"water\",\"title\":\"Amor\",\"text\":\"hello\"}'"
sleep 4; shot 7-opened

note "8 collect"
(adb shell pidof $PKG || echo DEAD) > $O/pid-end.txt
adb shell run-as $PKG cat shared_prefs/amor.xml > $O/prefs.xml 2>&1 || true
adb shell dumpsys alarm | grep -B2 -A6 "$PKG" > $O/alarm-end.txt || true
adb logcat -d > $O/logcat-full.txt
grep -E "AndroidRuntime|FATAL|VerifyError|NoSuchMethod|ClassNotFound|cloudweather|chromium.*Uncaught" $O/logcat-full.txt | head -300 > $O/logcat.txt || true
exit 0
