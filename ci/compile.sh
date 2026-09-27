#!/usr/bin/env bash
# 用 GitHub 构建机自带的官方 Android SDK 把 native/src 编译成 out/classes.dex
set -euo pipefail
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
PLAT=$(ls -d "$SDK"/platforms/android-* | grep -E 'android-[0-9]+$' | sort -V | tail -1)
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
echo "SDK=$SDK"; echo "platform=$PLAT"; echo "build-tools=$BT"; java -version 2>&1 | head -1
rm -rf out/classes && mkdir -p out/classes
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -Xlint:deprecation \
  -bootclasspath "$PLAT/android.jar" -classpath "$PLAT/android.jar" \
  -d out/classes $(find native/src -name '*.java')
"$BT/d8" --release --min-api 26 --lib "$PLAT/android.jar" --output out $(find out/classes -name '*.class')
ls -la out/classes.dex
echo "$(basename "$PLAT") $(basename "$BT")" > out/toolchain.txt
