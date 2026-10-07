package com.cloudweather.xiaoyu;

import android.view.Surface;

/**
 * 5.18 Wallpaper Engine 原生渲染（libwe.so，见 we/ 目录：开源逆向渲染器 wallpaper-scene-renderer 的安卓移植，Vulkan）。
 * 只是 JNI 入口；什么时候建、什么时候收由 WeWall 管。
 */
final class WeNative {
    private static int loaded = 0;   // 0 没试过 / 1 能用 / -1 加载失败
    static String loadErr = "";

    static synchronized boolean load() {
        if (loaded == 0) {
            try { System.loadLibrary("we"); loaded = 1; }
            catch (Throwable t) { loaded = -1; loadErr = String.valueOf(t); }
        }
        return loaded == 1;
    }

    static native long nCreate(Surface surface, String assets, String cache, int w, int h, int fps);
    static native void nLoad(long h, String source);
    static native void nView(long h, float x0, float y0, float w, float hh);
    static native void nPlay(long h);
    static native void nPause(long h);
    static native void nSpeed(long h, float speed);
    static native int nState(long h);
    static native String nInfo(long h);
    static native void nMouse(long h, float x, float y);
    static native void nDestroy(long h);

    private WeNative() { }
}
