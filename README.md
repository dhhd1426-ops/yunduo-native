# 云朵天气 · 原生层（通知模块）

这个仓库只用来在 GitHub Actions 上用 **官方 Android SDK** 编译原生代码，并在安卓模拟器上自动测试。

- `native/src/` — Java 源码：`MainActivity`（WebView 外壳）、`AmorBridge`（网页里的 `window.AmorNative`）、
  `AmorReceiver`（闹钟 / 通知按钮 / 开机重排）、`Scheduler`、`Notif`、`Store`
- `ci/compile.sh` — javac + d8 → `out/classes.dex`
- `ci/emu-test.sh` — 装调试包、排提醒、截图通知栏/横幅/锁屏、测按钮和用眼提醒
- `app/` — 打包脚本和网页（测试包用临时密钥签名；**正式签名密钥不在这里**）
- 结果推到 `ci-out` 分支：`classes.dex`、截图、日志

正式 APK 在本地用原来的密钥打包：把 `ci-out/classes.dex` 放到 `apk/native/classes.dex` 再运行 `python3 apk/build.py`。
