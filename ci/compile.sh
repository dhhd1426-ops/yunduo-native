#!/usr/bin/env bash
# 用 GitHub 构建机自带的官方 Android SDK：
#   aapt2 编译资源（布局/颜色/图标）+ 清单 → out/base.apk（正式）和 out/base-debug.apk（调试，CI 模拟器用）
#   javac（带 aapt2 生成的 R.java）+ d8 → out/classes.dex
set -euo pipefail
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
PLAT=$(ls -d "$SDK"/platforms/android-* | grep -E 'android-[0-9]+$' | sort -V | tail -1)
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
read VCODE VNAME < native/version.txt
echo "SDK=$SDK"; echo "platform=$PLAT"; echo "build-tools=$BT"; echo "version=$VCODE $VNAME"; java -version 2>&1 | head -1
rm -rf out/classes out/gen out/res.zip && mkdir -p out/classes out/gen
"$BT/aapt2" compile --dir native/res -o out/res.zip
LINK=(-I "$PLAT/android.jar" --manifest native/AndroidManifest.xml --min-sdk-version 26 --target-sdk-version 29
      --version-code "$VCODE" --version-name "$VNAME" --auto-add-overlay out/res.zip)
"$BT/aapt2" link -o out/base.apk --java out/gen "${LINK[@]}"
"$BT/aapt2" link -o out/base-debug.apk --debug-mode "${LINK[@]}"
unzip -l out/base.apk
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options \
  -bootclasspath "$PLAT/android.jar" -classpath "$PLAT/android.jar" \
  -d out/classes $(find native/src out/gen -name '*.java')
"$BT/d8" --release --min-api 26 --lib "$PLAT/android.jar" --output out $(find out/classes -name '*.class')
ls -la out/classes.dex out/base.apk out/base-debug.apk
echo "$(basename "$PLAT") $(basename "$BT")" > out/toolchain.txt
