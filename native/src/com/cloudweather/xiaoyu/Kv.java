package com.cloudweather.xiaoyu;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 5.17.3 网页的大块数据（聊天记录）改存成 App 自己的文件 files/kv/<名字>，不再挤在网页存储（约 5–10 MB 上限）里。
 * 写：网页分块传过来（begin → append… → commit），先写 <名字>.tmp 再改名，写到一半被杀掉也不会坏；commit 可以同步等写完，也可以交给后台线程。
 * 读：len 先把整个文件读进缓存，read 按位置分块取；分块时不切开一对代理字符（emoji），返回的长度可能比要的少一个。
 * 核心逻辑只依赖 File（tests/native/KvTest.java 在普通 JVM 上测）。
 */
final class Kv {
    private static final HashMap<String, StringBuilder> PEND = new HashMap<>();
    private static final HashMap<String, String> CACHE = new HashMap<>();
    private static final HashMap<String, Long> VER = new HashMap<>();
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    private Kv() {}

    static File dir(Context c) { return dir(c.getFilesDir()); }
    static File dir(File base) { File d = new File(base, "kv"); d.mkdirs(); return d; }

    static boolean okKey(String k) { return k != null && k.matches("[a-z0-9][a-z0-9._-]{0,63}") && !k.endsWith(".tmp"); }

    static synchronized void begin(String k) { if (okKey(k)) PEND.put(k, new StringBuilder()); }

    static synchronized void append(String k, String s) { StringBuilder b = PEND.get(k); if (b != null && s != null) b.append(s); }

    /** 交出这次写入。sync = true 时写完才返回（结果就是写没写成）；否则排进后台线程，返回 true 表示已排上。 */
    static boolean commit(final File d, final String k, boolean sync) {
        final String data;
        final long ver;
        synchronized (Kv.class) {
            StringBuilder b = PEND.remove(k);
            if (b == null) return false;
            data = b.toString();
            Long v = VER.get(k);
            ver = (v == null ? 0 : v) + 1;
            VER.put(k, ver);
            CACHE.remove(k);
        }
        if (sync) return write(d, k, data, ver);
        IO.execute(new Runnable() { @Override public void run() { write(d, k, data, ver); } });
        return true;
    }

    /** 后台排着好几次写时，只写最新的那次（旧的直接跳过）。 */
    static boolean write(File d, String k, String data, long ver) {
        synchronized (Kv.class) { Long v = VER.get(k); if (v != null && v != ver) return true; }
        File f = new File(d, k), t = new File(d, k + ".tmp");
        try {
            FileOutputStream o = new FileOutputStream(t);
            try { o.write(data.getBytes(StandardCharsets.UTF_8)); o.getFD().sync(); } finally { o.close(); }
            if (!t.renameTo(f)) { f.delete(); if (!t.renameTo(f)) return false; }
            return true;
        } catch (Throwable e) {
            t.delete();
            return false;
        }
    }

    /** 字符数；没有这个文件返回 -1。读进缓存，之后 read 分块取。 */
    static int len(File d, String k) {
        if (!okKey(k)) return -1;
        synchronized (Kv.class) { String c = CACHE.get(k); if (c != null) return c.length(); }
        File f = new File(d, k);
        if (!f.isFile()) return -1;
        try {
            InputStream in = new FileInputStream(f);
            ByteArrayOutputStream bo = new ByteArrayOutputStream((int) Math.min(f.length(), Integer.MAX_VALUE - 8));
            try { byte[] buf = new byte[65536]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); } finally { in.close(); }
            String s = new String(bo.toByteArray(), StandardCharsets.UTF_8);
            synchronized (Kv.class) { CACHE.put(k, s); }
            return s.length();
        } catch (Throwable e) {
            return -1;
        }
    }

    /** 从 off 起最多 n 个字符；读到末尾时清掉缓存。不切开代理对。 */
    static String read(String k, int off, int n) {
        String s;
        synchronized (Kv.class) { s = CACHE.get(k); }
        if (s == null || off < 0 || off >= s.length() || n <= 0) return "";
        int end = Math.min(s.length(), off + n);
        if (end < s.length() && end - off > 1 && Character.isHighSurrogate(s.charAt(end - 1))) end--;
        if (end >= s.length()) synchronized (Kv.class) { CACHE.remove(k); }
        return s.substring(off, end);
    }

    static boolean del(File d, String k) {
        if (!okKey(k)) return false;
        synchronized (Kv.class) { CACHE.remove(k); PEND.remove(k); Long v = VER.get(k); VER.put(k, (v == null ? 0 : v) + 1); }
        File f = new File(d, k);
        return !f.exists() || f.delete();
    }
}
