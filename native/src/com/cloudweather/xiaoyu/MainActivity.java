package com.cloudweather.xiaoyu;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 整个 App：一个全屏 WebView 加载 assets/index.html。
 * 3.8 起从手写 DEX 改为 Java 编译；行为和 3.7 完全一致，另外挂上 AmorNative（通知模块）。
 */
public class MainActivity extends Activity {
    private static final int WV_ID = 0x0100;
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        web = new WebView(this);
        web.setId(WV_ID);
        web.setBackgroundColor(0xFF141A2D);          // 启动瞬间就是开屏的深蓝，不闪白
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false); // Amor 的回复可以自动朗读
        s.setTextZoom(100);                            // 系统字体放大时页面不跟着放大
        web.setWebViewClient(new WebViewClient());
        try {
            web.addJavascriptInterface(new AmorBridge(this), "AmorNative");
        } catch (Throwable t) {
            Store.err(this, "bridge", t);
        }
        Store.saveLaunch(this, getIntent());
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // 点通知回到已经开着的 App：记下是哪条提醒，让网页接着聊
        if (Store.saveLaunch(this, intent)) js("window.__amorLaunch&&window.__amorLaunch()");
    }

    @Override
    protected void onResume() {
        super.onResume();
        js("window.__amorResume&&window.__amorResume()");
        try {
            Scheduler.rescheduleFire(getApplicationContext());   // 被小米“清理后台”强停过的话闹钟已经没了，这里补回来
            KeepService.sync(getApplicationContext());
            Alarms.rescheduleAll(getApplicationContext());
        } catch (Throwable t) {
            Store.err(this, "resume", t);
        }
    }

    private void js(String code) {
        try {
            if (web != null) web.evaluateJavascript(code, null);
        } catch (Throwable t) {
            Store.err(this, "js", t);
        }
    }

    // 返回键 / 侧滑返回：网页里还有上一级就退回上一级，没有才真正关闭（下次打开会播开屏）
    @Override
    public void onBackPressed() {
        WebView w = (WebView) findViewById(WV_ID);
        if (w != null && w.canGoBack()) {
            w.goBack();
            return;
        }
        finish();
    }
}
