package com.cloudweather.xiaoyu;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 5.0 壁纸：把用户选的（或用「云朵天气打开」的）壁纸文件复制进 App 自己的文件夹 files/amor/walls/，
 * 网页再用 file:// 读出来渲染。支持 Wallpaper Engine 的 .mpkg / scene.pkg，也支持普通图片和视频。
 * 壁纸是用户自己的文件，不上传、不分发。
 */
final class Walls {
    static File dir(Context c) { File d = new File(AmorFiles.dir(c), "walls"); d.mkdirs(); return d; }

    static String nameOf(Context c, Uri u) {
        String n = null;
        try (Cursor k = c.getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (k != null && k.moveToFirst()) n = k.getString(0);
        } catch (Throwable ignore) { }
        if (n == null) n = u.getLastPathSegment();
        return n == null ? "壁纸" : n;
    }

    /** 看文件头判断是什么：mpkg / pkg / 图片 / 视频；别的不收 */
    static String kind(byte[] h, int n, String name) {
        String low = name.toLowerCase();
        if (n >= 12) {
            String s = new String(h, 4, 8, java.nio.charset.StandardCharsets.ISO_8859_1);
            if (s.startsWith("PKGM") || s.startsWith("PKGV")) return "scene";
        }
        if (n >= 3 && (h[0] & 0xFF) == 0xFF && (h[1] & 0xFF) == 0xD8) return "image";
        if (n >= 4 && (h[0] & 0xFF) == 0x89 && h[1] == 'P' && h[2] == 'N' && h[3] == 'G') return "image";
        if (n >= 12 && h[8] == 'W' && h[9] == 'E' && h[10] == 'B' && h[11] == 'P') return "image";
        if (n >= 8 && h[4] == 'f' && h[5] == 't' && h[6] == 'y' && h[7] == 'p') return "video";
        if (n >= 4 && (h[0] & 0xFF) == 0x1A && (h[1] & 0xFF) == 0x45) return "video";   // webm
        if (low.endsWith(".mpkg") || low.endsWith(".pkg")) return "scene";
        return null;
    }

    /** 复制一份；返回 {path,name,size,kind} 或 {err} */
    static JSONObject copy(Context c, Uri u) {
        JSONObject o = new JSONObject();
        File f = null;
        try {
            String name = AmorFiles.safe(nameOf(c, u));
            f = new File(dir(c), System.currentTimeMillis() + "_" + name);
            byte[] head = new byte[16];
            int hn = 0;
            long size = 0;
            try (InputStream in = c.getContentResolver().openInputStream(u); OutputStream out = new FileOutputStream(f)) {
                if (in == null) throw new IllegalStateException("打不开这个文件");
                byte[] buf = new byte[256 * 1024];
                int r;
                while ((r = in.read(buf)) > 0) {
                    if (hn < 16) { int k = Math.min(16 - hn, r); System.arraycopy(buf, 0, head, hn, k); hn += k; }
                    out.write(buf, 0, r);
                    size += r;
                    if (size > 400L * 1024 * 1024) throw new IllegalStateException("文件太大了（超过 400MB）");
                }
            }
            String k = kind(head, hn, name);
            if (k == null) { f.delete(); o.put("err", "这不是壁纸包、图片或视频"); return o; }
            o.put("path", "file://" + f.getAbsolutePath());
            o.put("name", name);
            o.put("size", size);
            o.put("kind", k);
        } catch (Throwable t) {
            if (f != null) f.delete();
            try { o.put("err", String.valueOf(t.getMessage())); } catch (Throwable ignore) { }
            Store.err(c, "wallCopy", t);
        }
        return o;
    }

    /** 网页删壁纸：只能删 walls/ 里的 */
    static boolean delete(Context c, String path) {
        try {
            File f = AmorFiles.local(c, path);
            if (!f.getParentFile().getCanonicalPath().equals(dir(c).getCanonicalPath())) return false;
            return f.delete();
        } catch (Throwable t) { return false; }
    }
}
