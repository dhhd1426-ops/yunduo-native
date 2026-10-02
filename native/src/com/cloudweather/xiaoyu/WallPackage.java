package com.cloudweather.xiaoyu;

import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;

/** 按目录流式解包：不把几百 MB 的壁纸一次塞进 WebView，也不改动资源字节。 */
final class WallPackage {
    private static final class Entry {
        String name;
        long offset, size;
        Entry(String n, long o, long s) { name = n; offset = o; size = s; }
    }
    static File directory(File pack) { return new File(pack.getPath() + ".assets"); }
    private static String url(File f) throws Exception { return new java.net.URI("file", "", f.getAbsolutePath(), null).toASCIIString(); }
    private static long u32(RandomAccessFile in) throws Exception {
        return Integer.toUnsignedLong(Integer.reverseBytes(in.readInt()));
    }
    private static String text(RandomAccessFile in) throws Exception {
        long n = u32(in);
        if (n < 1 || n > 16384 || n > in.length() - in.getFilePointer()) throw new IllegalStateException("壁纸目录损坏");
        byte[] b = new byte[(int)n]; in.readFully(b);
        return new String(b, StandardCharsets.UTF_8);
    }
    static JSONObject extract(File pack) throws Exception {
        File root = directory(pack);
        if (!root.mkdirs() && !root.isDirectory()) throw new IllegalStateException("没有足够空间解包壁纸");
        try (RandomAccessFile in = new RandomAccessFile(pack, "r")) {
            String ver = text(in);
            if (!ver.matches("PKG[MV].*")) throw new IllegalStateException("不是 Wallpaper Engine 壁纸包");
            long count = u32(in);
            if (count > 100000) throw new IllegalStateException("壁纸目录损坏");
            ArrayList<Entry> entries = new ArrayList<>();
            HashSet<String> names = new HashSet<>();
            for (long i = 0; i < count; i++) {
                String name = text(in);
                if (!names.add(name)) throw new IllegalStateException("壁纸目录包含重复文件");
                entries.add(new Entry(name, u32(in), u32(in)));
            }
            long start = in.getFilePointer(), available = in.length() - start;
            JSONObject files = new JSONObject();
            String prefix = root.getCanonicalPath() + File.separator;
            byte[] buffer = new byte[256 * 1024];
            for (Entry e : entries) {
                if (e.offset > available || e.size > available - e.offset) throw new IllegalStateException("壁纸文件不完整");
                File f = new File(root, e.name).getCanonicalFile();
                if (!f.getPath().startsWith(prefix)) throw new IllegalStateException("壁纸文件路径无效");
                File parent = f.getParentFile();
                if (!parent.mkdirs() && !parent.isDirectory()) throw new IllegalStateException("没有足够空间解包壁纸");
                in.seek(start + e.offset);
                try (FileOutputStream out = new FileOutputStream(f)) {
                    long left = e.size;
                    while (left > 0) {
                        int n = in.read(buffer, 0, (int)Math.min(left, buffer.length));
                        if (n < 0) throw new IllegalStateException("壁纸文件不完整");
                        out.write(buffer, 0, n); left -= n;
                    }
                }
                files.put(e.name, url(f));
            }
            JSONObject manifest = new JSONObject().put("ver", ver).put("files", files);
            File index = new File(root, "__yunduo_manifest.json");
            // 目录名保留给引擎，防止覆盖壁纸自身的资源。
            if (names.contains(index.getName())) throw new IllegalStateException("壁纸目录包含保留名称");
            try (FileOutputStream out = new FileOutputStream(index)) {
                out.write(manifest.toString().getBytes(StandardCharsets.UTF_8));
            }
            JSONObject result = new JSONObject().put("pack", url(index));
            File project = new File(root, "project.json");
            if (project.isFile() && project.length() <= 8L * 1024 * 1024) {
                byte[] b = new byte[(int)project.length()];
                try (RandomAccessFile p = new RandomAccessFile(project, "r")) { p.readFully(b); }
                JSONObject pj = new JSONObject(new String(b, StandardCharsets.UTF_8));
                if (pj.optString("type").toLowerCase(java.util.Locale.ROOT).contains("video")) {
                    String media = files.optString(pj.optString("file"));
                    if (media.isEmpty()) throw new IllegalStateException("视频壁纸缺少视频文件");
                    result.put("mediaPath", media);
                }
            }
            return result;
        } catch (Exception e) { remove(root); throw e; }
    }
    static void remove(File f) {
        if (f.isDirectory()) { File[] children = f.listFiles(); if (children != null) for (File c : children) remove(c); }
        f.delete();
    }
}
