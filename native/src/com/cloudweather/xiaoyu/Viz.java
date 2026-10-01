package com.cloudweather.xiaoyu;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.audiofx.Visualizer;
import android.os.Build;
import android.os.SystemClock;

import java.util.Arrays;

/**
 * 5.11：动态壁纸「跟着声音动」（Wallpaper Engine 的 audio processing）。
 * 用系统的 Visualizer 挂在全局输出（session 0）上，读的是手机「正在播放」的声音（音乐、视频、Amor 朗读）的频谱，
 * 不录麦克风、不存、不上传。安卓把它算作录音权限（RECORD_AUDIO），没给就返回 "perm"，网页会显示「允许读取声音」。
 * 频谱按 30 Hz–16 kHz 对数分成 64 段，0–1；网页每帧来取（audioBands），自己做平滑再交给着色器的 g_AudioSpectrum*。
 */
class Viz implements Visualizer.OnDataCaptureListener {
    static final int REQ_VIZ = 49;
    private final MainActivity act;
    private Visualizer v;
    private final float[] bands = new float[64];
    private volatile long at;
    private boolean pend;

    Viz(MainActivity a) { act = a; }

    boolean hasPerm() {
        return Build.VERSION.SDK_INT < 23 || act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    synchronized String start() {
        if (!hasPerm()) return "perm";
        if (v != null) return "ok";
        try {
            v = new Visualizer(0);
            v.setEnabled(false);
            int[] r = Visualizer.getCaptureSizeRange();
            v.setCaptureSize(Math.max(r[0], Math.min(1024, r[1])));
            try { v.setScalingMode(Visualizer.SCALING_MODE_NORMALIZED); } catch (Throwable ignore) { }   // 音量调小也照样有节奏
            v.setDataCaptureListener(this, Math.min(Visualizer.getMaxCaptureRate(), 30000), false, true);   // 最多每秒 30 次
            v.setEnabled(true);
            return "ok";
        } catch (Throwable t) {
            Store.err(act, "viz", t);
            release();
            String m = t.getMessage();
            return "err:" + (m == null ? t.getClass().getSimpleName() : m.length() > 60 ? m.substring(0, 60) : m);
        }
    }

    synchronized void stop() { release(); }

    private void release() {
        if (v != null) {
            try { v.setEnabled(false); } catch (Throwable ignore) { }
            try { v.release(); } catch (Throwable ignore) { }
            v = null;
        }
        synchronized (bands) { Arrays.fill(bands, 0f); }
        at = 0;
    }

    void ask() {
        if (hasPerm()) { act.js("window.__vizPerm&&window.__vizPerm(true)"); return; }
        pend = true;
        act.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_VIZ);
    }

    void onPermission(boolean ok) {
        if (!pend) return;
        pend = false;
        act.js("window.__vizPerm&&window.__vizPerm(" + ok + ")");
    }

    @Override
    public void onWaveFormDataCapture(Visualizer vis, byte[] wave, int rate) { }

    @Override
    public void onFftDataCapture(Visualizer vis, byte[] fft, int rate) {
        if (fft == null || fft.length < 8) return;
        int n = fft.length / 2;
        double sr = rate / 1000.0, bw = sr / fft.length;      // rate 是毫赫兹的采样率
        if (bw <= 0) return;
        float[] out = new float[64];
        double lo = 30, hi = Math.min(16000, sr / 2 - bw);
        for (int i = 0; i < 64; i++) {
            double f0 = lo * Math.pow(hi / lo, i / 64.0), f1 = lo * Math.pow(hi / lo, (i + 1) / 64.0);
            int k0 = Math.max(1, (int) Math.floor(f0 / bw)), k1 = Math.min(n - 1, Math.max(k0 + 1, (int) Math.ceil(f1 / bw)));
            double m = 0;
            for (int k = k0; k < k1 && k < n; k++) { double re = fft[2 * k], im = fft[2 * k + 1]; m = Math.max(m, Math.hypot(re, im)); }
            double db = 20 * Math.log10(m + 1e-3);              // 一格最大约 181 → 45 dB
            out[i] = (float) Math.max(0, Math.min(1, (db - 6) / 36));
        }
        synchronized (bands) { System.arraycopy(out, 0, bands, 0, 64); }
        at = SystemClock.uptimeMillis();
    }

    /** CI 用：放 2 秒提示音，看 Visualizer 能不能建起来、有没有读到频谱，结果写进日志（Store.log "viz"） */
    static void probe(android.content.Context c) {
        android.media.ToneGenerator tg = null; Visualizer z = null;
        try {
            tg = new android.media.ToneGenerator(android.media.AudioManager.STREAM_MUSIC, 100);
            tg.startTone(android.media.ToneGenerator.TONE_DTMF_5, 2500);
            z = new Visualizer(0); z.setEnabled(false); z.setCaptureSize(1024); z.setEnabled(true);
            Thread.sleep(1200);
            byte[] f = new byte[1024]; z.getFft(f);
            double mx = 0; for (int k = 1; k < 512; k++) mx = Math.max(mx, Math.hypot(f[2 * k], f[2 * k + 1]));
            Store.log(c, "viz", "ok max=" + Math.round(mx));
        } catch (Throwable t) { Store.log(c, "viz", "err " + t); }
        finally { try { if (z != null) z.release(); } catch (Throwable ignore) { } try { if (tg != null) tg.release(); } catch (Throwable ignore) { } }
    }

    /** "0,123,…"（64 个，×1000）；一秒没新数据（没在放声音或被系统停了）返回空 */
    String get() {
        if (v == null || SystemClock.uptimeMillis() - at > 1000) return "";
        StringBuilder sb = new StringBuilder(320);
        synchronized (bands) { for (int i = 0; i < 64; i++) { if (i > 0) sb.append(','); sb.append(Math.round(bands[i] * 1000)); } }
        return sb.toString();
    }
}
