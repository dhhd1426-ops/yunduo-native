package com.cloudweather.xiaoyu;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.os.Bundle;
import android.os.PowerManager;
import android.util.Base64;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 发通知。提醒条目（item）由网页算好，字段：
 *   id(int) t(ms) ch("care"|"weather"|"amor") kind title text
 *   actions(["done","snooze","chat"]) cond("screen" = 亮屏在用才发) skipFg(bool) island(小米超级岛参数 JSON 字符串)
 * 配置（cfg）：icon/avatar(base64 PNG) color(int) lockFull(bool) island(bool) eye{...}
 */
final class Notif {
    static final String EXTRA_ITEM = "amor_item";
    static final String ACT_FIRE = "com.cloudweather.xiaoyu.FIRE";
    static final String ACT_EYE = "com.cloudweather.xiaoyu.EYE";
    static final String ACT_DONE = "com.cloudweather.xiaoyu.DONE";
    static final String ACT_SNOOZE = "com.cloudweather.xiaoyu.SNOOZE";

    private static final int PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    private Notif() {}

    static NotificationManager nm(Context c) {
        return (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    /** 三个渠道：关怀 / 天气 / 陪伴。都是重要（会弹横幅），锁屏可见。 */
    static void ensureChannels(Context c) {
        NotificationManager m = nm(c);
        if (m == null) return;
        channel(m, "care", "关怀提醒", "用眼、喝水、久坐、睡前");
        channel(m, "weather", "天气", "早安播报、下雨、降温、高温、预警");
        channel(m, "amor", "Amor 陪伴", "想你了、记得的日子");
    }

    private static void channel(NotificationManager m, String id, String name, String desc) {
        NotificationChannel ch = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(desc);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.enableVibration(true);
        ch.setShowBadge(true);
        m.createNotificationChannel(ch);
    }

    static boolean enabled(Context c) {
        NotificationManager m = nm(c);
        return m != null && m.areNotificationsEnabled();
    }

    /** 屏幕亮着并且已解锁 = 正在用手机 */
    static boolean inUse(Context c) {
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        KeyguardManager km = (KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
        boolean on = pm != null && pm.isInteractive();
        boolean locked = km != null && km.isKeyguardLocked();
        return on && !locked;
    }

    private static Bitmap bitmap(String b64) {
        if (b64 == null || b64.length() == 0) return null;
        try {
            int comma = b64.indexOf(',');
            if (b64.startsWith("data:") && comma > 0) b64 = b64.substring(comma + 1);
            byte[] raw = Base64.decode(b64, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(raw, 0, raw.length);
        } catch (Throwable t) {
            return null;
        }
    }

    /** 按规则发一条；返回是否真的发出去了 */
    static boolean post(Context c, JSONObject item) {
        String kind = item.optString("kind", "");
        try {
            long now = System.currentTimeMillis();
            if ("screen".equals(item.optString("cond", "")) && !inUse(c)) {
                Store.log(c, "skip-screen", kind);
                return false;
            }
            if (item.optBoolean("skipFg", false) && now - Store.getLong(c, "fgAt", 0) < 90_000L) {
                Store.log(c, "skip-fg", kind);
                return false;
            }
            NotificationManager m = nm(c);
            if (m == null) return false;
            ensureChannels(c);
            JSONObject cfg = Store.cfg(c);
            int id = item.optInt("id", (int) (now / 1000));
            String ch = item.optString("ch", "care");
            String title = item.optString("title", "Amor");
            String text = item.optString("text", "");

            Notification.Builder b = new Notification.Builder(c, ch);
            Bitmap ic = bitmap(cfg.optString("icon", ""));
            if (ic != null) b.setSmallIcon(Icon.createWithBitmap(ic));
            else b.setSmallIcon(c.getApplicationInfo().icon);
            Bitmap av = bitmap(cfg.optString("avatar", ""));
            b.setContentTitle(title);
            b.setContentText(item.optString("short", text));
            // 信笺样式：系统外框里放我们自己的一行排版（没有大头像、按钮做成小胶囊）；出错就用系统标准样式
            boolean letter = "letter".equals(cfg.optString("style", "letter")) && letterViews(c, b, item, cfg, id);
            if (!letter) {
                if (av != null) b.setLargeIcon(av);
                b.setStyle(new Notification.BigTextStyle().bigText(text));
            }
            b.setAutoCancel(true);
            b.setShowWhen(true);
            b.setWhen(now);
            b.setCategory(Notification.CATEGORY_REMINDER);
            b.setColor(cfg.optInt("color", 0xFFA0505D));
            b.setGroup("amor");
            b.setVisibility(cfg.optBoolean("lockFull", true) ? Notification.VISIBILITY_PUBLIC : Notification.VISIBILITY_PRIVATE);
            b.setContentIntent(openApp(c, id, item));

            JSONArray acts = letter ? null : item.optJSONArray("actions");
            Icon aic = ic != null ? Icon.createWithBitmap(ic) : Icon.createWithResource(c, c.getApplicationInfo().icon);
            if (acts != null) {
                for (int i = 0; i < acts.length(); i++) {
                    String a = acts.optString(i, "");
                    PendingIntent pi = null;
                    String label = null;
                    if ("done".equals(a)) { pi = action(c, ACT_DONE, id, item); label = item.optString("doneLabel", "好的"); }
                    else if ("snooze".equals(a)) { pi = action(c, ACT_SNOOZE, id, item); label = item.optString("snoozeLabel", "稍后提醒"); }
                    else if ("chat".equals(a)) { pi = openApp(c, id + 700000, item); label = "和 " + cfg.optString("name", "Amor") + " 聊聊"; }
                    if (pi != null) b.addAction(new Notification.Action.Builder(aic, label, pi).build());
                }
            }

            // 小米超级岛（焦点通知）：参数由网页生成；没通过小米审核时系统会当普通通知显示
            String island = item.optString("island", "");
            if (cfg.optBoolean("island", false) && island.length() > 0) {
                Bundle ex = new Bundle();
                ex.putString("miui.focus.param", island);
                if (av != null) {
                    Bundle pics = new Bundle();
                    pics.putParcelable("miui.focus.pic_avatar", Icon.createWithBitmap(av));
                    ex.putBundle("miui.focus.pics", pics);
                }
                b.addExtras(ex);
            }
            Notification n = b.build();
            if (cfg.optBoolean("island", false) && island.length() > 0) n.extras.putString("miui.focus.param", island);
            m.notify(id, n);
            Store.log(c, "posted", kind);
            return true;
        } catch (Throwable t) {
            Store.err(c, "post:" + kind, t);
            return false;
        }
    }

    /** 信笺样式的收起/展开布局（res/layout/nt_small.xml、nt_big.xml） */
    private static boolean letterViews(Context c, Notification.Builder b, JSONObject item, JSONObject cfg, int id) {
        try {
            String name = cfg.optString("name", "Amor");
            String mono = name.length() > 0 ? name.substring(0, 1).toUpperCase() : "A";
            String title = item.optString("title", name), text = item.optString("text", "");
            String meta = item.optString("meta", "");
            int prog = item.optInt("progress", -1);
            RemoteViews[] vs = { new RemoteViews(c.getPackageName(), R.layout.nt_small), new RemoteViews(c.getPackageName(), R.layout.nt_big) };
            for (int k = 0; k < 2; k++) {
                RemoteViews v = vs[k];
                v.setTextViewText(R.id.mono, mono);
                v.setTextViewText(R.id.title, title);
                v.setTextViewText(R.id.text, k == 0 ? item.optString("short", text) : text);
                v.setTextViewText(R.id.meta, meta);
                v.setViewVisibility(R.id.meta, meta.length() > 0 ? View.VISIBLE : View.GONE);
                if (prog >= 0) {
                    v.setProgressBar(R.id.bar, 100, Math.min(100, prog), false);
                    v.setViewVisibility(R.id.bar, View.VISIBLE);
                }
            }
            RemoteViews big = vs[1];
            JSONArray acts = item.optJSONArray("actions");
            int slot = 0;
            if (acts != null) {
                for (int i = 0; i < acts.length() && slot < 2; i++) {
                    String a = acts.optString(i, "");
                    String act = "done".equals(a) ? ACT_DONE : "snooze".equals(a) ? ACT_SNOOZE : null;
                    if (act == null) continue;
                    int vid = slot == 0 ? R.id.pill1 : R.id.pill2;
                    big.setTextViewText(vid, ACT_DONE.equals(act) ? item.optString("doneLabel", "好的") : item.optString("snoozeLabel", "稍后提醒"));
                    big.setOnClickPendingIntent(vid, action(c, act, id, item));
                    big.setViewVisibility(vid, View.VISIBLE);
                    slot++;
                }
            }
            big.setViewVisibility(R.id.pills, slot > 0 ? View.VISIBLE : View.GONE);
            b.setStyle(new Notification.DecoratedCustomViewStyle());
            b.setCustomContentView(vs[0]);
            b.setCustomHeadsUpContentView(vs[0]);
            b.setCustomBigContentView(big);
            return true;
        } catch (Throwable t) {
            Store.err(c, "letter", t);
            return false;
        }
    }

    private static PendingIntent openApp(Context c, int req, JSONObject item) {
        Intent i = new Intent(c, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra(EXTRA_ITEM, item.toString());
        return PendingIntent.getActivity(c, req, i, PI_FLAGS);
    }

    private static PendingIntent action(Context c, String act, int id, JSONObject item) {
        Intent i = new Intent(c, AmorReceiver.class);
        i.setAction(act);
        i.putExtra("id", id);
        i.putExtra(EXTRA_ITEM, item.toString());
        int req = (ACT_DONE.equals(act) ? 300000 : 500000) + (id % 100000);
        return PendingIntent.getBroadcast(c, req, i, PI_FLAGS);
    }
}
