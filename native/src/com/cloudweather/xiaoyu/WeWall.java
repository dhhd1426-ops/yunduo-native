package com.cloudweather.xiaoyu;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.PixelCopy;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 5.18 原生 Wallpaper Engine 壁纸：WebView 后面垫一块 SurfaceView，libwe.so 用 Vulkan 直接往上画。
 * 网页（index.html 的 Wall 模块）决定什么时候用：导入的 .mpkg 场景壁纸、手机有 Vulkan 时走这里，
 * 不行（加载失败 / 超时 / 没有 Vulkan）就告诉网页，网页退回自己的 WebGL 引擎。
 * 所有方法都在主线程调用（AmorBridge 负责转到主线程）。
 */
final class WeWall implements SurfaceHolder.Callback {
    private static final int LOAD_TIMEOUT_MS = 45000;
    private static final String ASSET_VER = "we-assets-1";

    private final MainActivity act;
    private final SurfaceView sv;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private long h = 0;
    private String src = null;          // 网页要画的壁纸（解包目录）；null = 不用原生
    private int fps = 30;
    private float speed = 1f;
    private boolean paused = false, surfaceOk = false, assetsOk = false, reported = false, everReady = false;
    private int sw = 0, sh = 0;
    private float[] view = null;
    private long loadAt = 0;
    private static int avail = 0;      // 0 没查 / 1 能用 / -1 不能用
    static String why = "";

    WeWall(MainActivity a, SurfaceView v) {
        act = a; sv = v;
        sv.getHolder().addCallback(this);
        sv.setVisibility(View.GONE);
    }

    /** 这台手机能不能用原生渲染：有 Vulkan、库加载得上、包里带了基础素材 */
    static boolean available(Context c) {
        if (avail != 0) return avail == 1;
        avail = -1;
        try {
            PackageManager pm = c.getPackageManager();
            if (Build.VERSION.SDK_INT < 29 || !pm.hasSystemFeature(PackageManager.FEATURE_VULKAN_HARDWARE_LEVEL)) { why = "no vulkan"; return false; }
            String[] probe = c.getAssets().list("we/shaders");
            if (probe == null || probe.length == 0) { why = "no assets"; return false; }
            if (!WeNative.load()) { why = "lib: " + WeNative.loadErr; return false; }
            avail = 1;
        } catch (Throwable t) { why = String.valueOf(t); }
        return avail == 1;
    }

    private File assetsDir() { return new File(act.getFilesDir(), "we/assets"); }
    private File cacheDir() { File d = new File(act.getCacheDir(), "we"); d.mkdirs(); return d; }

    /** 把 APK 里的 assets/we/ 拷到 files/we/assets/（渲染器要真实路径）；版本号不变就不重拷 */
    private static void copyAssets(Context c, File dst) throws Exception {
        long ver = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).lastUpdateTime;
        File mark = new File(dst, ".ver");
        String want = ASSET_VER + ":" + ver;
        if (mark.isFile()) {
            byte[] b = new byte[(int) Math.min(256, mark.length())];
            try (InputStream in = new java.io.FileInputStream(mark)) { int n = in.read(b); if (n > 0 && new String(b, 0, n, "UTF-8").equals(want)) return; }
        }
        WallPackage.remove(dst);
        copyTree(c.getAssets(), "we", dst);
        try (OutputStream o = new FileOutputStream(mark)) { o.write(want.getBytes("UTF-8")); }
    }

    private static void copyTree(AssetManager am, String path, File dst) throws Exception {
        String[] kids = am.list(path);
        if (kids != null && kids.length > 0) {
            dst.mkdirs();
            for (String k : kids) copyTree(am, path + "/" + k, new File(dst, k));
            return;
        }
        byte[] buf = new byte[64 * 1024];
        try (InputStream in = am.open(path); OutputStream out = new FileOutputStream(dst)) {
            int r; while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
        }
    }

    /** 网页：开始 / 换一张。dir = 壁纸解包目录 */
    void start(final String dir, int fps0, float speed0) {
        src = dir; fps = fps0 > 0 ? Math.min(60, fps0) : 30; speed = speed0; reported = false;
        act.setWebTransparent(true);
        if (sv.getVisibility() != View.VISIBLE) { sizeSurface(); sv.setVisibility(View.VISIBLE); }
        if (!assetsOk) {
            final Context app = act.getApplicationContext();
            final File dst = assetsDir();
            new Thread(new Runnable() { public void run() {
                String err = null;
                try { copyAssets(app, dst); } catch (Throwable t) { err = String.valueOf(t); Store.err(app, "weAssets", t); }
                final String e2 = err;
                ui.post(new Runnable() { public void run() {
                    if (e2 != null) { fail("assets: " + e2); return; }
                    assetsOk = true; ensure();
                } });
            } }).start();
            return;
        }
        ensure();
    }

    void stop() {
        src = null; view = null; everReady = false;
        ui.removeCallbacks(poll);
        destroy();
        sv.setVisibility(View.GONE);
        act.setWebTransparent(false);
    }

    void setView(float x0, float y0, float w, float hh) {
        view = new float[]{x0, y0, w, hh};
        if (h != 0) WeNative.nView(h, x0, y0, w, hh);
    }

    void setPaused(boolean p) {
        if (p != paused) android.util.Log.i("WeWall", "paused=" + p);
        paused = p;
        if (h != 0) { if (p) WeNative.nPause(h); else WeNative.nPlay(h); }
    }

    void setSpeed(float s) { speed = s; if (h != 0) WeNative.nSpeed(h, s); }

    boolean active() { return src != null; }

    /** 渲染分辨率：长边不超过 1920（高刷大屏手机上全分辨率跑模糊特效太费电），SurfaceView 自己放大铺满 */
    private void sizeSurface() {
        DisplayMetrics m = new DisplayMetrics();
        act.getWindowManager().getDefaultDisplay().getRealMetrics(m);
        int W = m.widthPixels, H = m.heightPixels;
        float k = Math.min(1f, 1920f / Math.max(W, H));
        sv.getHolder().setFixedSize(Math.max(64, Math.round(W * k)), Math.max(64, Math.round(H * k)));
    }

    private void ensure() {
        if (src == null || !assetsOk || !surfaceOk) return;
        if (h == 0) {
            h = WeNative.nCreate(sv.getHolder().getSurface(), assetsDir().getAbsolutePath(), cacheDir().getAbsolutePath(), sw, sh, fps);
            android.util.Log.i("WeWall", "create " + sw + "x" + sh + " h=" + h + " web=" + act.getWindow().getDecorView().getWidth());
            if (h == 0) { fail("create"); return; }
            if (view != null) WeNative.nView(h, view[0], view[1], view[2], view[3]);
        }
        if (everReady) act.js("window.__weState&&window.__weState('loading')");   // 退到后台回来要重新加载：网页先垫缩略图
        WeNative.nLoad(h, src);
        if (speed != 1f) WeNative.nSpeed(h, speed);
        if (paused) WeNative.nPause(h);
        loadAt = System.currentTimeMillis();
        ui.removeCallbacks(poll);
        ui.postDelayed(poll, 150);
    }

    private final Runnable poll = new Runnable() {
        public void run() {
            if (h == 0 || src == null) return;
            int s = WeNative.nState(h);
            if (s == 1) {
                if (!reported) { reported = true; everReady = true; String info = WeNative.nInfo(h); android.util.Log.i("WeWall", "ready " + info + " visible=" + (sv.getVisibility() == View.VISIBLE) + " paused=" + paused); act.js("window.__weState&&window.__weState('ready'," + q(info) + ")"); }
                return;
            }
            if (s < 0) { String info = WeNative.nInfo(h); fail(info.substring(Math.max(0, info.indexOf('|') + 1))); return; }
            if (System.currentTimeMillis() - loadAt > LOAD_TIMEOUT_MS) { fail("timeout"); return; }
            ui.postDelayed(this, 150);
        }
    };

    private void fail(String msg) {
        Store.err(act, "we", new RuntimeException(msg));
        ui.removeCallbacks(poll);
        src = null;
        destroy();
        sv.setVisibility(View.GONE);
        act.setWebTransparent(false);
        act.js("window.__weState&&window.__weState('fail'," + q(msg) + ")");
    }

    private void destroy() {
        if (h != 0) { long x = h; h = 0; try { WeNative.nDestroy(x); } catch (Throwable t) { Store.err(act, "weDestroy", t); } }
    }

    private static String q(String s) { return org.json.JSONObject.quote(s == null ? "" : s); }

    /** 网页要一张当前画面（虚化图、玻璃、雨的折射用）：PixelCopy 拷 SurfaceView，存成 JPEG */
    void snap(final int w, final int hh, final String tag) {
        if (h == 0 || !surfaceOk || Build.VERSION.SDK_INT < 24) { act.js("window.__weSnap&&window.__weSnap(" + q(tag) + ",'')"); return; }
        try {
            final Bitmap bmp = Bitmap.createBitmap(Math.max(16, w), Math.max(16, hh), Bitmap.Config.ARGB_8888);
            PixelCopy.request(sv, bmp, new PixelCopy.OnPixelCopyFinishedListener() {
                public void onPixelCopyFinished(int res) {
                    String url = "";
                    if (res == PixelCopy.SUCCESS) {
                        try {
                            File f = new File(cacheDir(), "snap-" + tag.replaceAll("[^a-z0-9]", "") + ".jpg");
                            try (OutputStream o = new FileOutputStream(f)) { bmp.compress(Bitmap.CompressFormat.JPEG, 88, o); }
                            url = "file://" + f.getAbsolutePath() + "?t=" + System.currentTimeMillis();
                        } catch (Throwable t) { Store.err(act, "weSnap", t); }
                    }
                    bmp.recycle();
                    act.js("window.__weSnap&&window.__weSnap(" + q(tag) + "," + q(url) + ")");
                }
            }, ui);
        } catch (Throwable t) {
            Store.err(act, "weSnap", t);
            act.js("window.__weSnap&&window.__weSnap(" + q(tag) + ",'')");
        }
    }

    @Override public void surfaceCreated(SurfaceHolder holder) { }

    @Override public void surfaceChanged(SurfaceHolder holder, int format, int w, int hh) {
        boolean resized = surfaceOk && (w != sw || hh != sh);
        surfaceOk = true; sw = w; sh = hh;
        if (resized) { destroy(); reported = false; }
        ensure();
    }

    @Override public void surfaceDestroyed(SurfaceHolder holder) {
        surfaceOk = false;
        ui.removeCallbacks(poll);
        destroy();   // 表面没了之前必须停掉渲染线程
        reported = false;
    }

    void onPause() { if (h != 0) WeNative.nPause(h); }
    void onResume() { if (h != 0 && !paused) WeNative.nPlay(h); }
}
