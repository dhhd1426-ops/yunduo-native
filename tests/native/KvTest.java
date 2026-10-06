package com.cloudweather.xiaoyu;

import java.io.File;
import java.nio.file.Files;

/** 5.17.3 Kv 的核心逻辑（不需要安卓）：分块写、同步/后台提交、只写最新一次、分块读不切开 emoji、删除、名字检查 */
public class KvTest {
    static int fails = 0;
    static void ok(String n, boolean c) { System.out.println((c ? "PASS " : "FAIL ") + n); if (!c) fails++; }

    static String readAll(File d, String k, int ch) {
        int n = Kv.len(d, k); if (n < 0) return null;
        StringBuilder b = new StringBuilder(); int off = 0;
        while (off < n) { String s = Kv.read(k, off, ch); if (s.isEmpty()) break; b.append(s); off += s.length(); }
        return b.toString();
    }

    public static void main(String[] a) throws Exception {
        File base = Files.createTempDirectory("kv").toFile(), d = Kv.dir(base);
        ok("没有文件时 len = -1", Kv.len(d, "chats.json") == -1);
        // 一大段带 emoji 的文字，分块写
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < 4000; i++) sb.append("{\"t\":\"第").append(i).append("段 你好😀🌧️ hello\"},");
        sb.append("{}]");
        String big = sb.toString();
        Kv.begin("chats.json");
        for (int o = 0; o < big.length(); o += 997) {
            int e = Math.min(big.length(), o + 997);
            if (e < big.length() && Character.isHighSurrogate(big.charAt(e - 1))) e--;   // 网页那边切块时也不切开代理对
            Kv.append("chats.json", big.substring(o, e)); o = e - 997;
        }
        ok("同步提交写成功", Kv.commit(d, "chats.json", true));
        ok("没有留下 .tmp", !new File(d, "chats.json.tmp").exists());
        for (int ch : new int[] { 1, 2, 3, 1000, 262144 }) ok("分块 " + ch + " 读回来和写进去一样", big.equals(readAll(d, "chats.json", ch)));
        // 分块读到 emoji 中间时少返回一个字符
        int at = big.indexOf("😀");
        String part = Kv.len(d, "chats.json") > 0 ? Kv.read("chats.json", 0, at + 1) : "";
        ok("分块不切开 emoji", part.length() == at && !Character.isHighSurrogate(part.charAt(part.length() - 1)));
        Kv.read("chats.json", 0, Integer.MAX_VALUE);   // 读到末尾，清缓存
        // 后台连续三次，只留最后一次
        for (int i = 1; i <= 3; i++) { Kv.begin("chats.json"); Kv.append("chats.json", "v" + i); Kv.commit(d, "chats.json", false); }
        Thread.sleep(500);
        ok("后台写：最后留下的是最新一次", "v3".equals(readAll(d, "chats.json", 100)));
        ok("没 begin 就 commit 返回 false", !Kv.commit(d, "x.json", true));
        ok("名字检查：不许 ../ 和 .tmp", !Kv.okKey("../a") && !Kv.okKey("a/b") && !Kv.okKey("a.tmp") && !Kv.okKey("") && Kv.okKey("chats.json"));
        Kv.begin("../evil"); ok("坏名字不会写", !Kv.commit(d, "../evil", true) && !new File(base, "evil").exists());
        ok("删除", Kv.del(d, "chats.json") && Kv.len(d, "chats.json") == -1);
        System.out.println(fails == 0 ? "ALL PASS" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
