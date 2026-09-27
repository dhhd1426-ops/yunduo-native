package com.cloudweather.xiaoyu;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 闹钟（4.1）：网页把闹钟列表交给这里（setAlarms），每个开着的闹钟用系统“闹钟级”定时（setAlarmClock）排好——
 * 省电模式、打盹模式下也准时，状态栏会显示闹钟图标。到点交给 AlarmService 响铃。
 * 列表字段：id h m days[1..7 周一..周日] date(YYYY-MM-DD，只响一次) on label snooze ramp text title name city
 */
final class Alarms {
    static final String ACT_ALARM = "com.cloudweather.xiaoyu.ALARM";
    private static final int PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    private Alarms() {}

    static JSONArray list(Context c) {
        try { return new JSONArray(Store.get(c, "alarms", "[]")); } catch (Throwable t) { return new JSONArray(); }
    }

    static JSONArray snoozes(Context c) {
        try { return new JSONArray(Store.get(c, "alarmSnz", "[]")); } catch (Throwable t) { return new JSONArray(); }
    }

    static void set(Context c, String json) {
        try {
            new JSONArray(json);
            Store.put(c, "alarms", json);
            rescheduleAll(c);
        } catch (Throwable t) {
            Store.err(c, "setAlarms", t);
        }
    }

    /** 下一次响的时间（毫秒），没有就返回 0 */
    static long next(JSONObject a, long now) {
        if (!a.optBoolean("on", false)) return 0;
        int h = a.optInt("h", 7), m = a.optInt("m", 0);
        String date = a.optString("date", "");
        JSONArray days = a.optJSONArray("days");
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(now);
        for (int k = 0; k < 8; k++) {
            Calendar d = (Calendar) cal.clone();
            d.add(Calendar.DAY_OF_YEAR, k);
            d.set(Calendar.HOUR_OF_DAY, h); d.set(Calendar.MINUTE, m); d.set(Calendar.SECOND, 0); d.set(Calendar.MILLISECOND, 0);
            long t = d.getTimeInMillis();
            if (t <= now) continue;
            if (date.length() == 10) {
                String ds = String.format(java.util.Locale.US, "%04d-%02d-%02d", d.get(Calendar.YEAR), d.get(Calendar.MONTH) + 1, d.get(Calendar.DAY_OF_MONTH));
                if (ds.equals(date)) return t;
                continue;
            }
            if (days != null && days.length() > 0) {
                int wd = d.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY ? 7 : d.get(Calendar.DAY_OF_WEEK) - 1;
                for (int i = 0; i < days.length(); i++) if (days.optInt(i) == wd) return t;
                continue;
            }
            return t;
        }
        return 0;
    }

    private static PendingIntent firePi(Context c, int id, boolean snooze) {
        Intent i = new Intent(c, AmorReceiver.class);
        i.setAction(ACT_ALARM);
        i.putExtra("id", id);
        i.putExtra("snz", snooze);
        return PendingIntent.getBroadcast(c, (snooze ? 900000 : 800000) + Math.abs(id % 90000), i, PI_FLAGS);
    }

    private static PendingIntent showPi(Context c) {
        Intent i = new Intent(c, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 7009, i, PI_FLAGS);
    }

    /** 全部重排：取消已经不在/关掉的，排好开着的，外加“再睡一会儿” */
    static void rescheduleAll(Context c) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long now = System.currentTimeMillis();
            JSONArray old;
            try { old = new JSONArray(Store.get(c, "alarmIds", "[]")); } catch (Throwable t) { old = new JSONArray(); }
            for (int i = 0; i < old.length(); i++) am.cancel(firePi(c, old.optInt(i), false));
            JSONArray L = list(c), ids = new JSONArray();
            long soonest = 0;
            for (int i = 0; i < L.length(); i++) {
                JSONObject a = L.optJSONObject(i);
                if (a == null) continue;
                long t = next(a, now);
                if (t <= 0) continue;
                int id = a.optInt("id");
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(t, showPi(c)), firePi(c, id, false));
                ids.put(id);
                if (soonest == 0 || t < soonest) soonest = t;
            }
            JSONArray sz = snoozes(c), keep = new JSONArray();
            for (int i = 0; i < sz.length(); i++) {
                JSONObject s = sz.optJSONObject(i);
                if (s == null) continue;
                long t = s.optLong("t");
                int id = s.optJSONObject("a") != null ? s.optJSONObject("a").optInt("id") : 0;
                am.cancel(firePi(c, id, true));
                if (t <= now - 60000) continue;
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(Math.max(t, now + 1000), showPi(c)), firePi(c, id, true));
                keep.put(s);
                if (soonest == 0 || t < soonest) soonest = t;
            }
            Store.put(c, "alarmIds", ids.toString());
            Store.put(c, "alarmSnz", keep.toString());
            Store.putLong(c, "alarmNext", soonest);
        } catch (Throwable t) {
            Store.err(c, "alarmResched", t);
        }
    }

    static JSONObject find(Context c, int id, boolean snooze) {
        if (snooze) {
            JSONArray sz = snoozes(c);
            for (int i = 0; i < sz.length(); i++) {
                JSONObject s = sz.optJSONObject(i);
                if (s != null && s.optJSONObject("a") != null && s.optJSONObject("a").optInt("id") == id) return s.optJSONObject("a");
            }
        }
        JSONArray L = list(c);
        for (int i = 0; i < L.length(); i++) {
            JSONObject a = L.optJSONObject(i);
            if (a != null && a.optInt("id") == id) return a;
        }
        return null;
    }

    /** 到点：响铃；只响一次的闹钟在本地关掉（网页下次打开时也会关掉） */
    static void fire(Context c, int id, boolean snooze) {
        try {
            JSONObject a = find(c, id, snooze);
            if (snooze) {
                JSONArray sz = snoozes(c), keep = new JSONArray();
                for (int i = 0; i < sz.length(); i++) { JSONObject s = sz.optJSONObject(i); if (s != null && !(s.optJSONObject("a") != null && s.optJSONObject("a").optInt("id") == id)) keep.put(s); }
                Store.put(c, "alarmSnz", keep.toString());
            }
            if (a == null) { Store.log(c, "alarm-miss", String.valueOf(id)); rescheduleAll(c); return; }
            JSONArray days = a.optJSONArray("days");
            if (!snooze && (days == null || days.length() == 0)) {
                JSONArray L = list(c);
                for (int i = 0; i < L.length(); i++) { JSONObject x = L.optJSONObject(i); if (x != null && x.optInt("id") == id) x.put("on", false); }
                Store.put(c, "alarms", L.toString());
            }
            JSONArray ev;
            try { ev = new JSONArray(Store.get(c, "alarmEv", "[]")); } catch (Throwable t) { ev = new JSONArray(); }
            ev.put(new JSONObject().put("id", id).put("t", System.currentTimeMillis()));
            Store.put(c, "alarmEv", ev.toString());
            Store.log(c, "alarm", a.optString("label", ""));
            AlarmService.start(c, a);
            rescheduleAll(c);
        } catch (Throwable t) {
            Store.err(c, "alarmFire", t);
        }
    }

    static void snooze(Context c, JSONObject a) {
        try {
            long t = System.currentTimeMillis() + Math.max(1, a.optInt("snooze", 10)) * 60_000L;
            JSONArray sz = snoozes(c), keep = new JSONArray();
            for (int i = 0; i < sz.length(); i++) { JSONObject s = sz.optJSONObject(i); if (s != null && !(s.optJSONObject("a") != null && s.optJSONObject("a").optInt("id") == a.optInt("id"))) keep.put(s); }
            keep.put(new JSONObject().put("t", t).put("a", a));
            Store.put(c, "alarmSnz", keep.toString());
            rescheduleAll(c);
        } catch (Throwable t) {
            Store.err(c, "alarmSnooze", t);
        }
    }
}
