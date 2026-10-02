package com.cloudweather.xiaoyu;

import android.app.Activity;
import android.app.AlarmManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

/** 网页里的 window.AmorNative。方法都在后台线程被调用，都不会抛异常到网页。 */
public class AmorBridge {
    private final Activity act;
    private final Context app;

    AmorBridge(Activity a) {
        act = a;
        app = a.getApplicationContext();
    }

    @JavascriptInterface
    public int version() {
        return 1;
    }

    /** 5.16.1 开关触觉：on = 轻"嗒"（CLOCK_TICK），off = 更轻的一下（API 27+ 用 TEXT_HANDLE_MOVE，否则 KEYBOARD_TAP）。成功返回 true。 */
    @JavascriptInterface
    public boolean haptic(final boolean on) {
        try {
            act.runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        android.view.View v = act.getWindow().getDecorView();
                        int kind = on ? android.view.HapticFeedbackConstants.CLOCK_TICK
                            : (Build.VERSION.SDK_INT >= 27 ? android.view.HapticFeedbackConstants.TEXT_HANDLE_MOVE : android.view.HapticFeedbackConstants.KEYBOARD_TAP);
                        v.performHapticFeedback(kind);
                    } catch (Throwable t) { Store.err(app, "haptic", t); }
                }
            });
            return true;
        } catch (Throwable t) { return false; }
    }

    /** 5.16.1 API 页触觉：0 轻点 · 1 嗒（CLOCK_TICK）· 2 中等 · 3 稍重（失败）。成功返回 true。 */
    @JavascriptInterface
    public boolean hapticLevel(final int level) {
        try {
            act.runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        android.view.View v = act.getWindow().getDecorView();
                        int sdk = Build.VERSION.SDK_INT, kind;
                        if (level <= 0) kind = sdk >= 27 ? android.view.HapticFeedbackConstants.TEXT_HANDLE_MOVE : android.view.HapticFeedbackConstants.KEYBOARD_TAP;
                        else if (level == 1) kind = android.view.HapticFeedbackConstants.CLOCK_TICK;
                        else if (level == 2) kind = sdk >= 30 ? android.view.HapticFeedbackConstants.CONFIRM : android.view.HapticFeedbackConstants.CONTEXT_CLICK;
                        else kind = sdk >= 30 ? android.view.HapticFeedbackConstants.REJECT : android.view.HapticFeedbackConstants.LONG_PRESS;
                        v.performHapticFeedback(kind);
                    } catch (Throwable t) { Store.err(app, "hapticLevel", t); }
                }
            });
            return true;
        } catch (Throwable t) { return false; }
    }

    /** 5.13 状态栏、手势条、刘海占掉的边（CSS 像素）"上,下,左,右" */
    @JavascriptInterface
    public String insets() {
        return act instanceof MainActivity ? ((MainActivity) act).insets : "0,0,0,0";
    }

    /** 5.13 状态栏图标：dark = 深色图标（背后是浅色页面），否则白色（壁纸、深色主题） */
    @JavascriptInterface
    public void barIcons(boolean dark) {
        try { if (act instanceof MainActivity) ((MainActivity) act).setBarIcons(dark); } catch (Throwable t) { Store.err(app, "barIcons", t); }
    }

    /** 设置：头像/小图标、颜色、锁屏是否显示内容、超级岛开关、用眼参数 */
    @JavascriptInterface
    public void setConfig(String json) {
        try {
            new JSONObject(json);
            Store.put(app, "cfg", json);
            Notif.ensureChannels(app);          // 安卓 13+ 第一次建渠道时系统会弹“允许通知”
            Scheduler.rescheduleEye(app, true);
            KeepService.sync(app);
        } catch (Throwable t) {
            Store.err(app, "setConfig", t);
        }
    }

    /** 计划：未来几天要发的提醒（JSON 数组），替换原来的计划 */
    @JavascriptInterface
    public void setPlan(String json) {
        try {
            JSONArray next = new JSONArray(json);
            // 点过“稍后提醒”的条目只存在原生层，网页不知道：同步时保留还没到时间的
            JSONArray old = Store.plan(app);
            long now = System.currentTimeMillis();
            for (int i = 0; i < old.length(); i++) {
                JSONObject o = old.optJSONObject(i);
                if (o != null && o.optBoolean("snoozed", false) && o.optLong("t", 0) > now) next.put(o);
            }
            Store.put(app, "plan", next.toString());
            Scheduler.rescheduleFire(app);
        } catch (Throwable t) {
            Store.err(app, "setPlan", t);
        }
    }

    @JavascriptInterface
    public boolean notifyNow(String itemJson) {
        try {
            return Notif.post(app, new JSONObject(itemJson));
        } catch (Throwable t) {
            Store.err(app, "notifyNow", t);
            return false;
        }
    }

    /** 过几秒再发（测试横幅用：App 在前台时小米不弹横幅，要先回到桌面） */
    @JavascriptInterface
    public boolean notifyLater(final String itemJson, int delayMs) {
        try {
            final JSONObject it = new JSONObject(itemJson);
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override public void run() { Notif.post(app, it); }
            }, Math.max(0, Math.min(60000, delayMs)));
            return true;
        } catch (Throwable t) {
            Store.err(app, "notifyLater", t);
            return false;
        }
    }

    /** 闹钟列表（4.1），替换原来的 */
    @JavascriptInterface
    public void setAlarms(String json) {
        Alarms.set(app, json);
    }

    /** 响过的闹钟（只响一次的，网页要把它关掉）；取一次就清掉 */
    @JavascriptInterface
    public String takeAlarmEvents() {
        String s = Store.get(app, "alarmEv", "[]");
        Store.remove(app, "alarmEv");
        return s;
    }

    @JavascriptInterface
    public boolean enabled() {
        try { return Notif.enabled(app); } catch (Throwable t) { return false; }
    }

    /** 诊断信息：权限、机型、下一次提醒、最近事件、最后一次错误 */
    @JavascriptInterface
    public String info() {
        try {
            JSONObject o = new JSONObject();
            o.put("enabled", Notif.enabled(app));
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("brand", Build.MANUFACTURER);
            o.put("model", Build.MODEL);
            boolean exact = true;
            if (Build.VERSION.SDK_INT >= 31) {
                AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
                exact = am != null && am.canScheduleExactAlarms();
            }
            o.put("exact", exact);
            o.put("next", Store.getLong(app, "next", 0));
            o.put("planned", Store.plan(app).length());
            o.put("eyeStart", Store.getLong(app, "eyeStart", 0));
            o.put("eyeTick", Store.getLong(app, "eyeTick", 0));
            o.put("inUse", Notif.inUse(app));
            o.put("plain", Store.getLong(app, "letterBad", 0) == 1);
            o.put("letterOk", Store.getLong(app, "letterOk", 0) > 0);
            try { o.put("ver", app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName); } catch (Throwable t) { o.put("ver", "?"); }
            android.app.NotificationManager m = Notif.nm(app);
            if (m != null) {
                o.put("filter", m.getCurrentInterruptionFilter());   // 1=正常 2/3/4=勿扰
                JSONObject chs = new JSONObject();
                for (android.app.NotificationChannel ch : m.getNotificationChannels()) chs.put(ch.getId(), ch.getImportance());   // 0=被关掉 1=最低 2=低 3=默认 4=高
                o.put("channels", chs);
                JSONArray act = new JSONArray();
                for (android.service.notification.StatusBarNotification sb : m.getActiveNotifications())
                    act.put(sb.getId() + ":" + sb.getNotification().getChannelId());
                o.put("active", act);
            }
            o.put("keep", KeepService.wanted(app));
            o.put("alarmNext", Store.getLong(app, "alarmNext", 0));
            o.put("alarms", Alarms.list(app).length());
            o.put("log", new JSONArray(Store.get(app, "log", "[]")));
            o.put("err", Store.get(app, "err", ""));
            o.put("errAt", Store.getLong(app, "errAt", 0));
            return o.toString();
        } catch (Throwable t) {
            return "{\"err\":\"" + String.valueOf(t).replace("\"", "'") + "\"}";
        }
    }

    /** 点通知打开 App 时的那条提醒；取一次就清掉 */
    @JavascriptInterface
    public String takeLaunch() {
        String s = Store.get(app, "launch", "");
        if (s.length() > 0) Store.remove(app, "launch");
        return s;
    }

    /** 网页正在和 Amor 聊天时每隔一会儿调用一次：这时不推送（除非是计时类提醒） */
    @JavascriptInterface
    public void fg() {
        Store.putLong(app, "fgAt", System.currentTimeMillis());
    }

    @JavascriptInterface
    public void clearLog() {
        Store.remove(app, "log");
        Store.remove(app, "err");
        Store.remove(app, "errAt");
    }

    /** 打开系统设置页：notif 通知权限 / autostart 小米自启动 / battery 省电策略（应用详情） */
    @JavascriptInterface
    public boolean open(String which) {
        try {
            String pkg = app.getPackageName();
            Intent i = null;
            if (which != null && which.startsWith("channel:")) {
                Notif.ensureChannels(app);
                i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
                i.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                i.putExtra(Settings.EXTRA_CHANNEL_ID, which.substring(8));
            } else if ("lockperm".equals(which)) {   // 小米：锁屏显示、后台弹出界面
                i = new Intent("miui.intent.action.APP_PERM_EDITOR");
                i.setClassName("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity");
                i.putExtra("extra_pkgname", pkg);
                if (!tryStart(i)) { i = new Intent("miui.intent.action.APP_PERM_EDITOR"); i.putExtra("extra_pkgname", pkg); }
            } else if ("notif".equals(which)) {
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                i.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
            } else if ("autostart".equals(which)) {
                i = new Intent();
                i.setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
            } else if ("battery".equals(which)) {
                i = new Intent();
                i.setComponent(new ComponentName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"));
                i.putExtra("package_name", pkg);
                i.putExtra("package_label", "云朵天气");
            }
            if (i != null && tryStart(i)) return true;
            Intent d = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
            return tryStart(d);
        } catch (Throwable t) {
            Store.err(app, "open:" + which, t);
            return false;
        }
    }

    /** 5.8：用手机浏览器打开网址（连接器登录授权、回答里的链接） */
    @JavascriptInterface
    public boolean openUrl(String url) {
        try {
            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return false;
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            return tryStart(i);
        } catch (Throwable t) {
            Store.err(app, "openUrl", t);
            return false;
        }
    }

    /** 5.8：登录授权后浏览器跳回来的地址（com.cloudweather.xiaoyu://oauth?code=…），取一次就清掉 */
    @JavascriptInterface
    public String takeOauth() {
        String u = MainActivity.oauthUrl;
        MainActivity.oauthUrl = null;
        return u == null ? "" : u;
    }

    /* ---------- 4.7 文件：网页分块写入 → 保存到下载 / 分享 / 用其它应用打开 ---------- */
    @JavascriptInterface
    public String fileBegin(String name, String mime) {
        try { return AmorFiles.begin(app, name, mime); } catch (Throwable t) { Store.err(app, "fileBegin", t); return ""; }
    }

    @JavascriptInterface
    public void fileAppend(String id, String b64) {
        try { AmorFiles.append(id, b64); } catch (Throwable t) { Store.err(app, "fileAppend", t); }
    }

    @JavascriptInterface
    public String fileEnd(String id) {
        try { return AmorFiles.end(id); } catch (Throwable t) { Store.err(app, "fileEnd", t); return "{}"; }
    }

    @JavascriptInterface
    public boolean fileExport(String path, String name, String mime) {
        try { AmorFiles.export(app, path, name, mime); return true; } catch (Throwable t) { Store.err(app, "fileExport", t); return false; }
    }

    @JavascriptInterface
    public boolean fileShare(String path, String mime) {
        try { return AmorFiles.send(act, app, path, mime, true); } catch (Throwable t) { Store.err(app, "fileShare", t); return false; }
    }

    @JavascriptInterface
    public boolean fileOpen(String path, String mime) {
        try { return AmorFiles.send(act, app, path, mime, false); } catch (Throwable t) { Store.err(app, "fileOpen", t); return false; }
    }

    /* ---------- 5.0 壁纸 ---------- */
    /** 打开系统的文件选择器选壁纸；选完后原生复制进 files/amor/walls/，再调 window.__wallIn() */
    @JavascriptInterface
    public void wallPick() {
        act.runOnUiThread(new Runnable() { @Override public void run() { if (act instanceof MainActivity) ((MainActivity) act).pickWall(); } });
    }

    /** 刚导入（或从别的 App 打开）的壁纸：{path,name,size,kind} / {err}；取一次就清掉 */
    @JavascriptInterface
    public String takeWall() {
        String s = Store.get(app, "wallin", "");
        if (s.length() > 0) Store.remove(app, "wallin");
        return s;
    }

    @JavascriptInterface
    public boolean wallDelete(String path) {
        return Walls.delete(app, path);
    }

    /** 定位权限：granted / denied（没问过也算 denied，网页调 geolocation 时系统会弹框） */
    @JavascriptInterface
    public String locState() {
        return act instanceof MainActivity && ((MainActivity) act).hasLoc() ? "granted" : "denied";
    }

    private boolean tryStart(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    // ---------- 5.4 语音 ----------
    private void ui(final Runnable r) { act.runOnUiThread(new Runnable() { @Override public void run() { try { r.run(); } catch (Throwable t) { Store.err(app, "voice", t); } } }); }
    private Voice v() { return act instanceof MainActivity ? ((MainActivity) act).voice : null; }

    /** {rec:有后台识别服务, mic:已有麦克风权限, dlg:有系统语音输入弹窗} */
    @JavascriptInterface
    public String sttInfo() {
        try {
            Voice v = v();
            android.content.Intent i = new android.content.Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            JSONObject o = v != null ? v.info() : new JSONObject();
            return o.put("rec", v != null && v.available()).put("mic", v != null && v.hasMic())
                .put("dlg", i.resolveActivity(app.getPackageManager()) != null).toString();
        } catch (Throwable t) { Store.err(app, "sttInfo", t); return "{}"; }
    }

    // 5.5.2：原生录音（语音对话的云端识别用），数据从 window.__mic 回来
    private Mic mic() { return act instanceof MainActivity ? ((MainActivity) act).mic : null; }
    @JavascriptInterface
    public String micInfo() {
        try { Voice v = v(); Mic m = mic(); return new JSONObject().put("ok", m != null).put("mic", v != null && v.hasMic()).put("aec", m != null && m.aecAvailable()).toString(); }
        catch (Throwable t) { return "{}"; }
    }
    @JavascriptInterface
    public void micStart() { ui(new Runnable() { public void run() { Mic m = mic(); if (m != null) m.start(); } }); }
    @JavascriptInterface
    public void micStop() { ui(new Runnable() { public void run() { Mic m = mic(); if (m != null) m.stop(true); } }); }

    // 5.11：动态壁纸跟着手机里正在放的声音动。audioStart 返回 ok / perm（没录音权限）/ err:…；audioBands 每帧取 64 段频谱
    private Viz viz() { return act instanceof MainActivity ? ((MainActivity) act).viz : null; }
    @JavascriptInterface
    public String audioStart() { try { Viz z = viz(); return z == null ? "err:none" : z.start(); } catch (Throwable t) { Store.err(app, "viz", t); return "err"; } }
    @JavascriptInterface
    public void audioStop() { try { Viz z = viz(); if (z != null) z.stop(); } catch (Throwable ignore) { } }
    @JavascriptInterface
    public String audioBands() { try { Viz z = viz(); return z == null ? "" : z.get(); } catch (Throwable t) { return ""; } }
    @JavascriptInterface
    public void audioPerm() { ui(new Runnable() { public void run() { Viz z = viz(); if (z != null) z.ask(); } }); }

    @JavascriptInterface
    public void sttStart(final String lang) { ui(new Runnable() { public void run() { Voice v = v(); if (v != null) v.start(lang); } }); }

    @JavascriptInterface
    public void sttDialog(final String lang) { ui(new Runnable() { public void run() { Voice v = v(); if (v != null) v.startIntent(lang); } }); }

    @JavascriptInterface
    public void sttStop() { ui(new Runnable() { public void run() { Voice v = v(); if (v != null) v.stop(); } }); }

    @JavascriptInterface
    public void sttCancel() { ui(new Runnable() { public void run() { Voice v = v(); if (v != null) v.cancel(); } }); }

    /** 系统朗读（火山朗读不可用时的兜底）；进度通过 __stt({t:'tts',e,id}) 回来 */
    @JavascriptInterface
    public void ttsSpeak(final String text, final float rate, final String id) { ui(new Runnable() { public void run() { Voice v = v(); if (v != null) v.speak(text, rate, id); } }); }

    @JavascriptInterface
    public void ttsStop() { ui(new Runnable() { public void run() { Voice v = v(); if (v != null) v.ttsStop(); } }); }

    @JavascriptInterface
    public void ttsWarm() { ui(new Runnable() { public void run() { Voice v = v(); if (v != null) v.ttsInit(); } }); }
}
