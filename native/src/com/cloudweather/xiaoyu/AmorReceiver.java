package com.cloudweather.xiaoyu;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

/** 闹钟到点、通知按钮、开机/更新后重排。所有异常都吞掉并记到诊断里。 */
public class AmorReceiver extends BroadcastReceiver {
    static final String ACT_TEST = "com.cloudweather.xiaoyu.TEST";   // 仅调试包（CI 测试）可用

    @Override
    public void onReceive(Context context, Intent intent) {
        Context c = context.getApplicationContext();
        String a = intent == null ? null : intent.getAction();
        if (a == null) return;
        try {
            if (Notif.ACT_FIRE.equals(a)) {
                Scheduler.fire(c);
            } else if (Notif.ACT_EYE.equals(a)) {
                Scheduler.eyeTick(c);
            } else if (Notif.ACT_DONE.equals(a)) {
                int id = intent.getIntExtra("id", 0);
                Notif.nm(c).cancel(id);
                Store.log(c, "done", kindOf(intent));
            } else if (Notif.ACT_SNOOZE.equals(a)) {
                int id = intent.getIntExtra("id", 0);
                Notif.nm(c).cancel(id);
                String item = intent.getStringExtra(Notif.EXTRA_ITEM);
                if (item != null) Scheduler.snooze(c, item);
                Store.log(c, "snooze", kindOf(intent));
            } else if (Intent.ACTION_BOOT_COMPLETED.equals(a)
                    || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
                    || Intent.ACTION_TIME_CHANGED.equals(a)
                    || Intent.ACTION_TIMEZONE_CHANGED.equals(a)
                    || "android.intent.action.QUICKBOOT_POWERON".equals(a)) {
                Store.log(c, "resched", a.substring(a.lastIndexOf('.') + 1));
                Scheduler.rescheduleAll(c);
                KeepService.sync(c);
            } else if (ACT_TEST.equals(a) && debuggable(c)) {
                test(c, intent);
            }
        } catch (Throwable t) {
            Store.err(c, "recv:" + a, t);
        }
    }

    private static String kindOf(Intent i) {
        try {
            String s = i.getStringExtra(Notif.EXTRA_ITEM);
            return s == null ? "" : new JSONObject(s).optString("kind", "");
        } catch (Throwable t) {
            return "";
        }
    }

    private static boolean debuggable(Context c) {
        return (c.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /** 测试参数用 base64 传（adb 命令行里直接写 JSON 容易被转义弄坏） */
    private static String arg(Intent i, String k, Context c) throws Exception {
        String f = i.getStringExtra(k + "File");   // App 私有目录里的文件（CI 用 run-as 写进去）
        if (f != null) {
            java.io.File file = new java.io.File(c.getFilesDir(), f);
            byte[] buf = new byte[(int) file.length()];
            java.io.FileInputStream in = new java.io.FileInputStream(file);
            try { int off = 0; while (off < buf.length) { int r = in.read(buf, off, buf.length - off); if (r < 0) break; off += r; } }
            finally { in.close(); }
            return new String(buf, "UTF-8");
        }
        String b = i.getStringExtra(k + "64");
        if (b != null) return new String(Base64.decode(b, Base64.DEFAULT), "UTF-8");
        return i.getStringExtra(k);
    }

    /** CI 测试钩子：cfg / plan（plan 里的 dt = 距现在多少秒）/ post / eye */
    private static void test(Context c, Intent i) throws Exception {
        String cfg = arg(i, "cfg", c);
        if (cfg != null) { Store.put(c, "cfg", cfg); KeepService.sync(c); }
        String plan = arg(i, "plan", c);
        if (plan != null) {
            JSONArray in = new JSONArray(plan), out = new JSONArray();
            long now = System.currentTimeMillis();
            for (int k = 0; k < in.length(); k++) {
                JSONObject o = in.getJSONObject(k);
                if (o.has("dt")) o.put("t", now + o.getLong("dt") * 1000L);
                out.put(o);
            }
            Store.put(c, "plan", out.toString());
            Notif.ensureChannels(c);
            Scheduler.rescheduleAll(c);
        }
        String post = arg(i, "post", c);
        if (post != null) Notif.post(c, new JSONObject(post));
        if (i.hasExtra("eyeStart")) Store.putLong(c, "eyeStart", System.currentTimeMillis() - i.getIntExtra("eyeStart", 0) * 60_000L);
        if (i.getBooleanExtra("eye", false)) Scheduler.eyeTick(c);
        if (i.getBooleanExtra("fire", false)) Scheduler.fire(c);
        Store.log(c, "test", null);
    }
}
