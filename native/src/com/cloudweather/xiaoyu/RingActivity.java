package com.cloudweather.xiaoyu;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/** 响铃页（4.1）：锁屏上也能显示，点亮屏幕；内容是 assets/ring.html。关闭/再睡都交回 AlarmService。 */
public class RingActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        if (AlarmService.current == null) { finish(); return; }
        web = new WebView(this);
        web.setBackgroundColor(0xFF0A1022);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "Ring");
        web.loadUrl("file:///android_asset/ring.html");
        setContentView(web);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (AlarmService.current == null) finish();
        else if (web != null) web.reload();
    }

    @Override
    public void onBackPressed() {
        // 返回键不关闹钟，只是回到后台（铃声继续），要关请滑动或点通知上的「关闭」
        moveTaskToBack(true);
    }

    private void send(String act) {
        Intent i = new Intent(this, AlarmService.class);
        i.setAction(act);
        try { startService(i); } catch (Throwable t) { Store.err(this, "ringSend", t); }
    }

    class Bridge {
        @JavascriptInterface public String data() {
            try {
                JSONObject o = new JSONObject();
                o.put("alarm", new JSONObject(AlarmService.current == null ? "{}" : AlarmService.current));
                o.put("color", Store.cfg(RingActivity.this).optInt("color", 0xFFA0505D));
                o.put("now", System.currentTimeMillis());
                return o.toString();
            } catch (Throwable t) { return "{}"; }
        }
        @JavascriptInterface public boolean alive() { return AlarmService.current != null; }
        @JavascriptInterface public void dismiss() { send(AlarmService.ACT_DISMISS); runOnUiThread(new Runnable() { @Override public void run() { finish(); } }); }
        @JavascriptInterface public void snooze() { send(AlarmService.ACT_SNOOZE); runOnUiThread(new Runnable() { @Override public void run() { finish(); } }); }
        @JavascriptInterface public void close() { runOnUiThread(new Runnable() { @Override public void run() { finish(); } }); }
    }
}
