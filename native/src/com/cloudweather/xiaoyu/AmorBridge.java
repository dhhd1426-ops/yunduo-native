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

    /** 设置：头像/小图标、颜色、锁屏是否显示内容、超级岛开关、用眼参数 */
    @JavascriptInterface
    public void setConfig(String json) {
        try {
            new JSONObject(json);
            Store.put(app, "cfg", json);
            Notif.ensureChannels(app);          // 安卓 13+ 第一次建渠道时系统会弹“允许通知”
            Scheduler.rescheduleEye(app, true);
        } catch (Throwable t) {
            Store.err(app, "setConfig", t);
        }
    }

    /** 计划：未来几天要发的提醒（JSON 数组），替换原来的计划 */
    @JavascriptInterface
    public void setPlan(String json) {
        try {
            new JSONArray(json);
            Store.put(app, "plan", json);
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
            if ("notif".equals(which)) {
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

    private boolean tryStart(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
