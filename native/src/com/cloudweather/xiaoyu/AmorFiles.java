package com.cloudweather.xiaoyu;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.UUID;

/**
 * 4.7 Amor 交给用户的文件（导出的视频、配乐、打包的 zip、网页…）。
 * 网页分块把内容传过来，先存在 App 自己的文件夹 files/amor/（网页用 file:// 读回来预览）；
 * 「保存到手机」再复制到 下载/云朵天气（安卓 10+ 走 MediaStore，不要存储权限）；分享、用其它应用打开都用那个 content:// 地址。
 */
final class AmorFiles {
    private static final HashMap<String, OutputStream> OPEN = new HashMap<>();
    private static final HashMap<String, File> FILES = new HashMap<>();

    static File dir(Context c) { File d = new File(c.getFilesDir(), "amor"); d.mkdirs(); return d; }

    static String safe(String name) {
        String n = name == null ? "文件" : name.replaceAll("[\\\\/:*?\"<>|\\u0000-\\u001f]", "_").trim();
        if (n.isEmpty()) n = "文件";
        return n.length() > 80 ? n.substring(n.length() - 80) : n;
    }

    static synchronized String begin(Context c, String name, String mime) throws Exception {
        File f = new File(dir(c), System.currentTimeMillis() + "_" + safe(name));
        String id = UUID.randomUUID().toString();
        OPEN.put(id, new FileOutputStream(f));
        FILES.put(id, f);
        return id;
    }

    static synchronized void append(String id, String b64) throws Exception {
        OutputStream os = OPEN.get(id);
        if (os == null) throw new IllegalStateException("no such file " + id);
        os.write(Base64.decode(b64, Base64.DEFAULT));
    }

    static synchronized String end(String id) throws Exception {
        OutputStream os = OPEN.remove(id);
        File f = FILES.remove(id);
        if (os != null) os.close();
        JSONObject o = new JSONObject();
        if (f != null) { o.put("path", "file://" + f.getAbsolutePath()); o.put("size", f.length()); }
        return o.toString();
    }

    /** 网页传来的 file:// 路径 → 只允许 files/amor/ 里面的文件 */
    static File local(Context c, String path) throws Exception {
        String p = path == null ? "" : path.replaceFirst("^file://", "");
        File f = new File(p).getCanonicalFile();
        if (!f.getPath().startsWith(dir(c).getCanonicalPath() + File.separator) || !f.isFile()) throw new SecurityException("bad path");
        return f;
    }

    /** 复制到 下载/云朵天气，返回 content:// 地址（同一个文件只复制一次） */
    static Uri export(Context c, String path, String name, String mime) throws Exception {
        File f = local(c, path);
        String key = "fx:" + f.getName();
        String had = Store.get(c, key, "");
        if (!had.isEmpty()) {
            Uri u = Uri.parse(had);
            try (InputStream t = c.getContentResolver().openInputStream(u)) { if (t != null) return u; } catch (Throwable ignore) { }
        }
        Uri out;
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver r = c.getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, safe(name));
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/云朵天气");
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            out = r.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (out == null) throw new IllegalStateException("insert failed");
            try (InputStream in = new FileInputStream(f); OutputStream os = r.openOutputStream(out)) { copy(in, os); }
            v.clear();
            v.put(MediaStore.MediaColumns.IS_PENDING, 0);
            r.update(out, v, null, null);
        } else {
            // 安卓 8/9：放在 App 自己的下载目录（不要权限），也能在文件管理里找到
            File d = new File(c.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "云朵天气"); d.mkdirs();
            File dst = new File(d, safe(name));
            try (InputStream in = new FileInputStream(f); OutputStream os = new FileOutputStream(dst)) { copy(in, os); }
            out = Uri.fromFile(dst);
        }
        Store.put(c, key, out.toString());
        return out;
    }

    static boolean send(Activity act, Context c, String path, String mime, boolean share) throws Exception {
        File f = local(c, path);
        String name = f.getName().replaceFirst("^\\d+_", "");
        Uri u = export(c, path, name, mime);
        if (!"content".equals(u.getScheme())) return false;
        Intent i;
        if (share) {
            i = new Intent(Intent.ACTION_SEND);
            i.setType(mime == null || mime.isEmpty() ? "*/*" : mime);
            i.putExtra(Intent.EXTRA_STREAM, u);
            i = Intent.createChooser(i, "分享 " + name);
        } else {
            i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(u, mime == null || mime.isEmpty() ? "*/*" : mime);
        }
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        act.startActivity(i);
        return true;
    }

    private static void copy(InputStream in, OutputStream os) throws Exception {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
    }
}
