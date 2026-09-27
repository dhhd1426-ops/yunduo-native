package com.cloudweather.xiaoyu;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 系统闹钟排程。App 关着也能按时提醒，不常驻后台。
 *  - FIRE：计划里最近的一条到点 → 发出 → 排下一条（精确、省电模式下也按时）
 *  - EYE ：每 5 分钟看一次屏幕（不唤醒手机：手机睡着时闹钟会推迟，据此判断中间息屏过）
 */
final class Scheduler {
    static final long EYE_EVERY = 5 * 60_000L;
    private static final long LATE_OK = 15 * 60_000L;   // 晚到 15 分钟内的提醒照发，更晚的丢掉
    private static final int PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    private Scheduler() {}

    private static AlarmManager am(Context c) {
        return (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    }

    private static PendingIntent pi(Context c, String action, int req) {
        Intent i = new Intent(c, AmorReceiver.class);
        i.setAction(action);
        return PendingIntent.getBroadcast(c, req, i, PI_FLAGS);
    }

    /** 全部重排（网页更新计划、开机、App 更新后调用） */
    static void rescheduleAll(Context c) {
        rescheduleFire(c);
        rescheduleEye(c, true);
    }

    static void rescheduleFire(Context c) {
        try {
            long now = System.currentTimeMillis();
            JSONArray plan = Store.plan(c), keep = new JSONArray();
            long next = Long.MAX_VALUE;
            for (int i = 0; i < plan.length(); i++) {
                JSONObject it = plan.optJSONObject(i);
                if (it == null) continue;
                long t = it.optLong("t", 0);
                if (t < now - LATE_OK) continue;
                keep.put(it);
                if (t < next) next = t;
            }
            if (keep.length() != plan.length()) Store.put(c, "plan", keep.toString());
            AlarmManager a = am(c);
            if (a == null) return;
            PendingIntent p = pi(c, Notif.ACT_FIRE, 1);
            if (next == Long.MAX_VALUE) {
                a.cancel(p);
                Store.putLong(c, "next", 0);
                return;
            }
            long when = Math.max(next, now + 1000);
            a.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, p);
            Store.putLong(c, "next", when);
        } catch (Throwable t) {
            Store.err(c, "rescheduleFire", t);
        }
    }

    static void rescheduleEye(Context c, boolean resetStreak) {
        try {
            AlarmManager a = am(c);
            if (a == null) return;
            PendingIntent p = pi(c, Notif.ACT_EYE, 2);
            JSONObject eye = Store.cfg(c).optJSONObject("eye");
            if (eye == null || !eye.optBoolean("on", false)) {
                a.cancel(p);
                Store.putLong(c, "eyeStart", 0);
                return;
            }
            if (resetStreak) Store.putLong(c, "eyeTick", System.currentTimeMillis());
            a.setAndAllowWhileIdle(AlarmManager.RTC, System.currentTimeMillis() + EYE_EVERY, p);
        } catch (Throwable t) {
            Store.err(c, "rescheduleEye", t);
        }
    }

    /** 到点：发出所有已经到时间的提醒，删掉，再排下一条 */
    static void fire(Context c) {
        long now = System.currentTimeMillis();
        JSONArray plan = Store.plan(c), keep = new JSONArray();
        int sent = 0;
        for (int i = 0; i < plan.length(); i++) {
            JSONObject it = plan.optJSONObject(i);
            if (it == null) continue;
            long t = it.optLong("t", 0);
            if (t <= now + 5_000L) {
                if (t >= now - LATE_OK && Notif.post(c, it)) sent++;
            } else {
                keep.put(it);
            }
        }
        Store.put(c, "plan", keep.toString());
        Store.log(c, "fire", String.valueOf(sent));
        rescheduleFire(c);
    }

    /** 用眼：连续在用手机满 N 分钟就提醒；中间息屏（或手机睡着导致闹钟推迟）就重新计 */
    static void eyeTick(Context c) {
        long now = System.currentTimeMillis();
        rescheduleEye(c, false);
        JSONObject cfg = Store.cfg(c);
        JSONObject eye = cfg.optJSONObject("eye");
        if (eye == null || !eye.optBoolean("on", false)) return;
        long last = Store.getLong(c, "eyeTick", 0);
        Store.putLong(c, "eyeTick", now);
        int h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        int from = eye.optInt("from", 8), to = eye.optInt("to", 23);
        boolean inWindow = from <= to ? (h >= from && h < to) : (h >= from || h < to);
        boolean gap = last > 0 && now - last > EYE_EVERY + EYE_EVERY / 2 + 60_000L;
        if (!inWindow || gap || !Notif.inUse(c)) {
            Store.putLong(c, "eyeStart", 0);
            return;
        }
        long start = Store.getLong(c, "eyeStart", 0);
        if (start == 0) {
            Store.putLong(c, "eyeStart", now - EYE_EVERY / 2);
            return;
        }
        long need = eye.optLong("min", 45) * 60_000L;
        if (now - start < need) return;
        try {
            JSONObject item = new JSONObject();
            JSONArray texts = eye.optJSONArray("texts");
            int n = (int) Store.getLong(c, "eyeIdx", 0);
            String text = texts != null && texts.length() > 0 ? texts.optString(n % texts.length(), "") : "";
            if (text.length() == 0) text = "已经连续看屏幕 " + eye.optLong("min", 45) + " 分钟啦，看看远处 20 秒吧～";
            Store.putLong(c, "eyeIdx", n + 1);
            item.put("id", 9100 + (n % 20));
            item.put("ch", "care");
            item.put("kind", "eye");
            item.put("title", eye.optString("title", "休息一下眼睛"));
            item.put("text", text);
            item.put("actions", new JSONArray().put("done").put("snooze"));
            item.put("doneLabel", "好，休息一下");
            item.put("snoozeLabel", "再 10 分钟");
            item.put("snoozeMin", 10);
            item.put("island", eye.optString("island", ""));
            if (Notif.post(c, item)) Store.putLong(c, "eyeStart", now);
        } catch (Throwable t) {
            Store.err(c, "eye", t);
        }
    }

    /** 稍后提醒：同一条过 N 分钟再发（默认 30） */
    static void snooze(Context c, String itemJson) {
        try {
            JSONObject it = new JSONObject(itemJson);
            long min = it.optLong("snoozeMin", 30);
            it.put("t", System.currentTimeMillis() + min * 60_000L);
            it.put("cond", "");
            JSONArray plan = Store.plan(c);
            plan.put(it);
            Store.put(c, "plan", plan.toString());
            rescheduleFire(c);
        } catch (Throwable t) {
            Store.err(c, "snooze", t);
        }
    }
}
