package com.cloudweather.xiaoyu;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/** 本地存储（SharedPreferences）+ 诊断日志。所有方法都不会抛异常。 */
final class Store {
    static final String PREFS = "amor";
    private static final int LOG_MAX = 40;

    private Store() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String get(Context c, String k, String def) {
        try { return prefs(c).getString(k, def); } catch (Throwable t) { return def; }
    }

    static long getLong(Context c, String k, long def) {
        try { return prefs(c).getLong(k, def); } catch (Throwable t) { return def; }
    }

    static void put(Context c, String k, String v) {
        try { prefs(c).edit().putString(k, v).commit(); } catch (Throwable ignored) {}
    }

    static void putLong(Context c, String k, long v) {
        try { prefs(c).edit().putLong(k, v).commit(); } catch (Throwable ignored) {}
    }

    static void remove(Context c, String k) {
        try { prefs(c).edit().remove(k).commit(); } catch (Throwable ignored) {}
    }

    static JSONObject cfg(Context c) {
        try { return new JSONObject(get(c, "cfg", "{}")); } catch (Throwable t) { return new JSONObject(); }
    }

    static JSONArray plan(Context c) {
        try { return new JSONArray(get(c, "plan", "[]")); } catch (Throwable t) { return new JSONArray(); }
    }

    /** 记一条事件：posted / skip / done / snooze / fire / eye …（只留最近 40 条） */
    static synchronized void log(Context c, String event, String kind) {
        try {
            JSONArray a;
            try { a = new JSONArray(get(c, "log", "[]")); } catch (Throwable t) { a = new JSONArray(); }
            JSONObject o = new JSONObject();
            o.put("t", System.currentTimeMillis());
            o.put("e", event);
            if (kind != null) o.put("k", kind);
            a.put(o);
            JSONArray out = new JSONArray();
            for (int i = Math.max(0, a.length() - LOG_MAX); i < a.length(); i++) out.put(a.get(i));
            put(c, "log", out.toString());
        } catch (Throwable ignored) {}
    }

    static void err(Context c, String where, Throwable t) {
        try {
            String msg = where + ": " + t;
            StackTraceElement[] st = t.getStackTrace();
            if (st != null && st.length > 0) msg += " @ " + st[0];
            put(c, "err", msg);
            putLong(c, "errAt", System.currentTimeMillis());
            log(c, "err", where);
        } catch (Throwable ignored) {}
    }

    /** 从通知打开 App 时，把那条提醒存下来给网页取；返回是否带了提醒 */
    static boolean saveLaunch(Context c, Intent intent) {
        try {
            if (intent == null) return false;
            String item = intent.getStringExtra(Notif.EXTRA_ITEM);
            if (item == null || item.length() == 0) return false;
            JSONObject o = new JSONObject(item);
            o.put("openedAt", System.currentTimeMillis());
            put(c, "launch", o.toString());
            intent.removeExtra(Notif.EXTRA_ITEM);
            log(c, "open", o.optString("kind", ""));
            return true;
        } catch (Throwable t) {
            err(c, "launch", t);
            return false;
        }
    }
}
