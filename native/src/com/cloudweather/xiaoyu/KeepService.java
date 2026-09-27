package com.cloudweather.xiaoyu;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 常驻后台（可选）：一个前台服务 + 通知栏里一条很小的常驻通知，让系统（尤其小米）不要把 App 清掉。
 * 被划掉任务时尝试 2 秒后自己再起来；被“强行停止”后要等下次打开 App 或开机才会恢复。
 */
public class KeepService extends Service {
    static final int NID = 7;
    static final String CH = "keep";

    static boolean wanted(Context c) {
        return Store.cfg(c).optBoolean("keep", false) && Notif.enabled(c);
    }

    /** 按设置启动/停止 */
    static void sync(Context c) {
        try {
            Intent i = new Intent(c, KeepService.class);
            if (wanted(c)) c.startForegroundService(i);
            else c.stopService(i);
        } catch (Throwable t) {
            Store.err(c, "keep", t);
        }
    }

    /** 计划变了：刷新常驻通知上的“下一条提醒” */
    static void refresh(Context c) {
        try {
            if (!wanted(c)) return;
            NotificationManager m = Notif.nm(c);
            if (m != null) m.notify(NID, build(c));
        } catch (Throwable t) {
            Store.err(c, "keepRefresh", t);
        }
    }

    private static void channel(Context c) {
        NotificationManager m = Notif.nm(c);
        if (m == null) return;
        NotificationChannel ch = new NotificationChannel(CH, "常驻后台", NotificationManager.IMPORTANCE_MIN);
        ch.setDescription("让提醒准时：通知栏里一条不响不震的常驻通知");
        ch.setShowBadge(false);
        ch.enableVibration(false);
        ch.setSound(null, null);
        ch.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
        m.createNotificationChannel(ch);
    }

    static Notification build(Context c) {
        channel(c);
        String name = Store.cfg(c).optString("name", "Amor");
        long next = Store.getLong(c, "next", 0);
        String text = next > System.currentTimeMillis()
                ? "下一条提醒 " + new SimpleDateFormat(sameDay(next) ? "HH:mm" : "M月d日 HH:mm", Locale.CHINA).format(new Date(next))
                : "有提醒时会准时叫你";
        Intent open = new Intent(c, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 7007, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(c, CH)
                .setSmallIcon(R.drawable.nt_icon)
                .setContentTitle(name + " 在后台陪着你")
                .setContentText(text)
                .setOngoing(true)
                .setShowWhen(false)
                .setColor(Store.cfg(c).optInt("color", 0xFFA0505D))
                .setVisibility(Notification.VISIBILITY_SECRET)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setContentIntent(pi)
                .build();
    }

    private static boolean sameDay(long t) {
        SimpleDateFormat f = new SimpleDateFormat("yyyyMMdd", Locale.CHINA);
        return f.format(new Date(t)).equals(f.format(new Date()));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            startForeground(NID, build(this));
            if (!wanted(this)) { stopForeground(true); stopSelf(); return START_NOT_STICKY; }
            Store.log(this, "keep", "on");
        } catch (Throwable t) {
            Store.err(this, "keepStart", t);
        }
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // 最近任务里被划掉：闹钟重排一遍，2 秒后把自己再拉起来
        try {
            Scheduler.rescheduleAll(this);
            if (wanted(this)) {
                PendingIntent p = PendingIntent.getForegroundService(this, 7008, new Intent(this, KeepService.class),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                AlarmManager a = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (a != null) a.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 2000, p);
            }
            Store.log(this, "keep", "swiped");
        } catch (Throwable t) {
            Store.err(this, "keepSwipe", t);
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
