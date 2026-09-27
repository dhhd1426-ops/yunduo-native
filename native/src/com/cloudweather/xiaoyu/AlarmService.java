package com.cloudweather.xiaoyu;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import org.json.JSONObject;

/**
 * 响铃（4.1）：前台服务放闹钟铃声（闹钟音量通道，可渐强）+ 震动，同时发一条“全屏”通知——
 * 锁屏/息屏时系统直接弹出 RingActivity；正在用手机时显示成横幅，带「关闭」「再睡 N 分钟」。
 * 10 分钟没人理就自动停下，并留一条“错过的闹钟”。
 */
public class AlarmService extends Service {
    static final String ACT_START = "com.cloudweather.xiaoyu.ALARM_START";
    static final String ACT_DISMISS = "com.cloudweather.xiaoyu.ALARM_DISMISS";
    static final String ACT_SNOOZE = "com.cloudweather.xiaoyu.ALARM_SNOOZE";
    static final String CH = "alarm";
    static final int NID = 8;
    static volatile String current = null;     // 正在响的那个闹钟（JSON）；RingActivity 用它显示内容

    private MediaPlayer mp;
    private Vibrator vib;
    private PowerManager.WakeLock wl;
    private final Handler h = new Handler(Looper.getMainLooper());
    private long t0;
    private boolean ramp;

    static void start(Context c, JSONObject a) {
        Intent i = new Intent(c, AlarmService.class);
        i.setAction(ACT_START);
        i.putExtra("a", a.toString());
        c.startForegroundService(i);
    }

    static void channel(Context c) {
        NotificationManager m = Notif.nm(c);
        if (m == null) return;
        NotificationChannel ch = new NotificationChannel(CH, "闹钟", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("到点全屏响铃");
        ch.setSound(null, null);             // 铃声由这里自己放（闹钟音量通道）
        ch.enableVibration(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.setBypassDnd(true);
        m.createNotificationChannel(ch);
    }

    private static PendingIntent svcPi(Context c, String act, int req) {
        Intent i = new Intent(c, AlarmService.class);
        i.setAction(act);
        return PendingIntent.getService(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent ringPi(Context c) {
        Intent i = new Intent(c, RingActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        return PendingIntent.getActivity(c, 7010, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification build(JSONObject a) {
        channel(this);
        String hm = String.format(java.util.Locale.US, "%02d:%02d", a.optInt("h"), a.optInt("m"));
        String label = a.optString("label", "");
        int snz = Math.max(1, a.optInt("snooze", 10));
        JSONObject cfg = Store.cfg(this);
        Notification.Builder b = new Notification.Builder(this, CH)
                .setSmallIcon(R.drawable.nt_icon)
                .setContentTitle(hm + (label.length() > 0 ? " · " + label : " · 闹钟"))
                .setContentText(a.optString("text", ""))
                .setStyle(new Notification.BigTextStyle().bigText(a.optString("text", "")))
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setShowWhen(false)
                .setColor(cfg.optInt("color", 0xFFA0505D))
                .setFullScreenIntent(ringPi(this), true)
                .setContentIntent(ringPi(this));
        android.graphics.drawable.Icon ic = android.graphics.drawable.Icon.createWithResource(this, R.drawable.nt_icon);
        b.addAction(new Notification.Action.Builder(ic, "再睡 " + snz + " 分钟", svcPi(this, ACT_SNOOZE, 7011)).build());
        b.addAction(new Notification.Action.Builder(ic, "关闭", svcPi(this, ACT_DISMISS, 7012)).build());
        return b.build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String act = intent == null ? null : intent.getAction();
        try {
            if (ACT_START.equals(act)) {
                String s = intent.getStringExtra("a");
                JSONObject a = new JSONObject(s == null ? "{}" : s);
                stopSound();
                current = a.toString();
                startForeground(NID, build(a));
                ramp = a.optBoolean("ramp", true);
                startSound();
                startVibrate();
                try {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "yunduo:alarm");
                    wl.acquire(10 * 60_000L);
                } catch (Throwable ignored) {}
                // 正在用手机时系统只显示横幅；App 在前台时直接打开响铃页
                try { Intent r = new Intent(this, RingActivity.class); r.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(r); } catch (Throwable ignored) {}
                h.removeCallbacksAndMessages(null);
                h.postDelayed(timeout, 10 * 60_000L);
                if (ramp) h.post(rampStep);
                Store.log(this, "ring", a.optString("label", ""));
            } else if (ACT_SNOOZE.equals(act)) {
                if (current != null) Alarms.snooze(this, new JSONObject(current));
                Store.log(this, "ring-snooze", null);
                finishRing();
            } else if (ACT_DISMISS.equals(act)) {
                Store.log(this, "ring-off", null);
                finishRing();
            } else if (current == null) {
                stopSelf();
            }
        } catch (Throwable t) {
            Store.err(this, "alarmSvc", t);
            finishRing();
        }
        return START_NOT_STICKY;
    }

    private final Runnable timeout = new Runnable() {
        @Override public void run() {
            try {
                if (current != null) {
                    JSONObject a = new JSONObject(current);
                    JSONObject miss = new JSONObject();
                    miss.put("id", 9300); miss.put("ch", "amor"); miss.put("kind", "alarm-miss");
                    miss.put("title", "错过了一个闹钟");
                    miss.put("text", String.format(java.util.Locale.US, "%02d:%02d 的闹钟响了 10 分钟，没有人关。", a.optInt("h"), a.optInt("m")));
                    finishRing();
                    Notif.post(AlarmService.this, miss);
                    return;
                }
            } catch (Throwable ignored) {}
            finishRing();
        }
    };

    private final Runnable rampStep = new Runnable() {
        @Override public void run() {
            if (mp == null) return;
            float k = Math.min(1f, 0.08f + (System.currentTimeMillis() - t0) / 60_000f);
            try { mp.setVolume(k, k); } catch (Throwable ignored) {}
            if (k < 1f) h.postDelayed(this, 1500);
        }
    };

    private void startSound() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null && am.getStreamVolume(AudioManager.STREAM_ALARM) == 0)
                am.setStreamVolume(AudioManager.STREAM_ALARM, Math.max(1, am.getStreamMaxVolume(AudioManager.STREAM_ALARM) / 2), 0);
            Uri u = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
            if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            mp = new MediaPlayer();
            mp.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            mp.setDataSource(this, u);
            mp.setLooping(true);
            mp.prepare();
            t0 = System.currentTimeMillis();
            float v = ramp ? 0.08f : 1f;
            mp.setVolume(v, v);
            mp.start();
        } catch (Throwable t) {
            Store.err(this, "alarmSound", t);
            try { if (mp != null) mp.release(); } catch (Throwable ignored) {}
            mp = null;
        }
    }

    private void startVibrate() {
        try {
            vib = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vib != null && vib.hasVibrator())
                vib.vibrate(VibrationEffect.createWaveform(new long[]{0, 700, 600}, 0),
                        new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        } catch (Throwable ignored) {}
    }

    private void stopSound() {
        try { if (mp != null) { mp.stop(); mp.release(); } } catch (Throwable ignored) {}
        mp = null;
        try { if (vib != null) vib.cancel(); } catch (Throwable ignored) {}
    }

    private void finishRing() {
        h.removeCallbacksAndMessages(null);
        stopSound();
        current = null;
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Throwable ignored) {}
        try { stopForeground(true); } catch (Throwable ignored) {}
        stopSelf();
    }

    @Override
    public void onDestroy() {
        h.removeCallbacksAndMessages(null);
        stopSound();
        current = null;
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Throwable ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
