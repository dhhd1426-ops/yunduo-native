package com.cloudweather.xiaoyu;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.graphics.Color;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/**
 * 整个 App：一个全屏 WebView 加载 assets/index.html。
 * 3.8 起从手写 DEX 改为 Java 编译；另外挂上 AmorNative（通知模块）。
 * 5.0：网页的文件选择框、导入壁纸（也能从别的 App「用云朵天气打开」.mpkg）、网页定位（只要大概位置，用来找最近的气象站）。
 */
public class MainActivity extends Activity {
    private static final int WV_ID = 0x0100;
    static volatile String oauthUrl;   // 5.8：连接器登录授权的回调
    static final int REQ_FILE = 41, REQ_WALL = 42, REQ_LOC = 43, REQ_WMIC = 46, REQ_CAM = 48;
    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private GeolocationPermissions.Callback geoCb;
    private String geoOrigin;
    private Uri photoUri;              // 5.7：+ 面板「相机」拍的那张
    private PermissionRequest micReq;   // 5.5：网页要麦克风（语音模式自己录音、云端识别）
    Voice voice;                 // 5.4：麦克风听写 / 语音模式 / 系统朗读兜底
    Mic mic;                     // 5.5.2：语音对话的原生录音（通话模式，带回声消除）
    Viz viz;                     // 5.11：动态壁纸跟着手机里正在放的声音动（Visualizer 频谱）
    volatile String insets = "0,0,0,0";   // 5.13 状态栏 / 手势条 / 刘海占掉的边（CSS 像素：上,下,左,右）
    private boolean darkIcons = false;

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
        s.setGeolocationEnabled(true);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                // 5.7：网页要拍照（<input capture>）→ 直接开系统相机，照片存进 相册/云朵天气（安卓 10+ 走 MediaStore，不用存储和相机权限）
                if (p.isCaptureEnabled() && Build.VERSION.SDK_INT >= 29) {
                    try {
                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.Images.Media.DISPLAY_NAME, "yunduo_" + System.currentTimeMillis() + ".jpg");
                        cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                        cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/云朵天气");
                        photoUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                        Intent ci = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        ci.putExtra(MediaStore.EXTRA_OUTPUT, photoUri);
                        ci.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivityForResult(ci, REQ_CAM);
                        return true;
                    } catch (Throwable t) {
                        Store.err(MainActivity.this, "camera", t);
                        if (photoUri != null) { try { getContentResolver().delete(photoUri, null, null); } catch (Throwable ignore) { } photoUri = null; }
                    }
                }
                try {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.setType("*/*");
                    String[] types = p.getAcceptTypes();
                    if (types != null && types.length == 1 && types[0] != null && types[0].contains("/") && !types[0].contains(",")) i.setType(types[0]);
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(i, REQ_FILE);
                } catch (Throwable t) {
                    ValueCallback<Uri[]> failed = fileCb; fileCb = null;
                    if (failed != null) failed.onReceiveValue(null);
                    Store.err(MainActivity.this, "chooser", t);
                    return true;
                }
                return true;
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasLoc()) { cb.invoke(origin, true, false); return; }
                geoCb = cb; geoOrigin = origin;
                if (Build.VERSION.SDK_INT >= 23) requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
                else cb.invoke(origin, true, false);
            }

            // 5.5：网页 getUserMedia 录音。只给麦克风（不给摄像头），系统权限没给就先要
            @Override
            public void onPermissionRequest(final PermissionRequest r) {
                boolean wantMic = false;
                for (String res : r.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) wantMic = true;
                if (!wantMic) { r.deny(); return; }
                if (voice != null && voice.hasMic()) { r.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}); return; }
                if (micReq != null) { try { micReq.deny(); } catch (Throwable ignore) { } }
                micReq = r;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_WMIC);
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest r) {
                if (micReq == r) micReq = null;
            }
        });
        try {
            web.addJavascriptInterface(new AmorBridge(this), "AmorNative");
        } catch (Throwable t) {
            Store.err(this, "bridge", t);
        }
        voice = new Voice(this);
        mic = new Mic(this);
        viz = new Viz(this);
        Store.saveLaunch(this, getIntent());
        takeShared(getIntent());
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
        edgeToEdge();
    }

    /** 5.13 壁纸铺满整块屏幕：状态栏、手势条透明，刘海那一条也画；网页按 insets 自己让开 */
    private void edgeToEdge() {
        try {
            Window w = getWindow();
            w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= 29) { w.setStatusBarContrastEnforced(false); w.setNavigationBarContrastEnforced(false); }
            if (Build.VERSION.SDK_INT >= 28) {
                WindowManager.LayoutParams lp = w.getAttributes();
                lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30 ? 3 /* ALWAYS */ : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                w.setAttributes(lp);
            }
            applyBars();
            web.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                    try {
                        int t = in.getSystemWindowInsetTop(), b = in.getSystemWindowInsetBottom(), l = in.getSystemWindowInsetLeft(), r = in.getSystemWindowInsetRight();
                        // 铺满以后系统不再替我们给键盘让位：键盘弹出时把网页底边抬到键盘上面（和原来 adjustResize 一样），手势条那一截就不用让了
                        int ime;
                        if (Build.VERSION.SDK_INT >= 30) { ime = in.getInsets(WindowInsets.Type.ime()).bottom; b = ime > 0 ? 0 : in.getInsets(WindowInsets.Type.navigationBars()).bottom; }
                        else { int nav = in.getStableInsetBottom(); ime = b > nav + 40 ? b : 0; b = ime > 0 ? 0 : nav; }
                        android.view.ViewGroup.LayoutParams lp0 = web.getLayoutParams();
                        if (lp0 instanceof android.view.ViewGroup.MarginLayoutParams && ((android.view.ViewGroup.MarginLayoutParams) lp0).bottomMargin != ime) {
                            ((android.view.ViewGroup.MarginLayoutParams) lp0).bottomMargin = ime; web.setLayoutParams(lp0);
                        }
                        if (Build.VERSION.SDK_INT >= 28 && in.getDisplayCutout() != null) {
                            android.view.DisplayCutout c = in.getDisplayCutout();
                            t = Math.max(t, c.getSafeInsetTop()); b = Math.max(b, c.getSafeInsetBottom()); l = Math.max(l, c.getSafeInsetLeft()); r = Math.max(r, c.getSafeInsetRight());
                        }
                        float d = getResources().getDisplayMetrics().density;
                        String s2 = Math.round(t / d) + "," + Math.round(b / d) + "," + Math.round(l / d) + "," + Math.round(r / d);
                        if (!s2.equals(insets)) { insets = s2; js("window.__insets&&window.__insets('" + s2 + "')"); }
                    } catch (Throwable e) { Store.err(MainActivity.this, "insets", e); }
                    return in;
                }
            });
            web.requestApplyInsets();
        } catch (Throwable t) {
            Store.err(this, "edge", t);
        }
    }

    private void applyBars() {
        int f = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        if (darkIcons) { f |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR; if (Build.VERSION.SDK_INT >= 26) f |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR; }
        getWindow().getDecorView().setSystemUiVisibility(f);
    }

    /** 网页说：现在背后是浅色（要深色图标）还是深色 / 壁纸（白色图标） */
    void setBarIcons(final boolean dark) {
        runOnUiThread(new Runnable() { public void run() { try { if (dark != darkIcons) { darkIcons = dark; applyBars(); } } catch (Throwable t) { Store.err(MainActivity.this, "bars", t); } } });
    }

    boolean hasLoc() {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** 网页点「导入壁纸」 */
    void pickWall() {
        try {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            startActivityForResult(i, REQ_WALL);
        } catch (Throwable t) {
            Store.err(this, "pickWall", t);
            wallDone(errJson("打不开文件选择器"));
        }
    }

    private static String errJson(String m) { try { return new JSONObject().put("err", m).toString(); } catch (Throwable t) { return "{}"; } }

    private void wallDone(String json) {
        Store.put(this, "wallin", json);
        js("window.__wallIn&&window.__wallIn()");
    }

    private void copyWall(final Uri u) {
        final android.content.Context app = getApplicationContext();
        js("window.__wallBusy&&window.__wallBusy(1)");
        new Thread(new Runnable() {
            @Override public void run() {
                final String r = Walls.copy(app, u).toString();
                runOnUiThread(new Runnable() { @Override public void run() { wallDone(r); } });
            }
        }).start();
    }

    /** 从别的 App 分享 / 用云朵天气打开 */
    private void takeShared(Intent it) {
        if (it == null) return;
        Uri u = null;
        String a = it.getAction();
        Uri d0 = it.getData();
        if (Intent.ACTION_VIEW.equals(a) && d0 != null && "com.cloudweather.xiaoyu".equals(d0.getScheme())) {
            oauthUrl = d0.toString();
            it.setAction(null);
            js("window.__oauthCb&&window.__oauthCb()");
            return;
        }
        if (Intent.ACTION_VIEW.equals(a)) u = it.getData();
        else if (Intent.ACTION_SEND.equals(a)) u = it.getParcelableExtra(Intent.EXTRA_STREAM);
        if (u == null) return;
        it.setAction(null);            // 转屏重建时不再导入一次
        copyWall(u);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE) {
            ValueCallback<Uri[]> cb = fileCb; fileCb = null;
            if (cb != null) {
                Uri[] uris = null;
                if (res == RESULT_OK && data != null) {
                    android.content.ClipData clips = data.getClipData();
                    if (clips != null && clips.getItemCount() > 0) {
                        uris = new Uri[clips.getItemCount()];
                        for (int i = 0; i < uris.length; i++) uris[i] = clips.getItemAt(i).getUri();
                    } else if (data.getData() != null) uris = new Uri[]{data.getData()};
                }
                cb.onReceiveValue(uris);
            }
        } else if (req == REQ_CAM) {
            Uri u = photoUri; photoUri = null;
            if (res == RESULT_OK && u != null) { if (fileCb != null) fileCb.onReceiveValue(new Uri[]{u}); }
            else {
                if (u != null) { try { getContentResolver().delete(u, null, null); } catch (Throwable ignore) { } }
                if (fileCb != null) fileCb.onReceiveValue(null);
            }
            fileCb = null;
        } else if (req == Voice.REQ_STT) {
            if (voice != null) voice.onActivityResult(res, data);
        } else if (req == REQ_WALL) {
            Uri u = res == RESULT_OK && data != null ? data.getData() : null;
            if (u == null) { wallDone(errJson("cancel")); return; }
            try { getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Throwable ignore) { }
            copyWall(u);
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] p, int[] g) {
        if (req == REQ_WMIC) {
            PermissionRequest r = micReq; micReq = null;
            if (r != null) {
                try {
                    if (g.length > 0 && g[0] == PackageManager.PERMISSION_GRANTED) r.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    else r.deny();
                } catch (Throwable t) { Store.err(this, "wmic", t); }
            }
            return;
        }
        if (req == Viz.REQ_VIZ) {
            if (viz != null) viz.onPermission(g.length > 0 && g[0] == PackageManager.PERMISSION_GRANTED);
            return;
        }
        if (req == Mic.REQ_NMIC) {
            if (mic != null) mic.onPermission(g.length > 0 && g[0] == PackageManager.PERMISSION_GRANTED);
            return;
        }
        if (req == Voice.REQ_MIC) {
            if (voice != null) voice.onPermission(g.length > 0 && g[0] == PackageManager.PERMISSION_GRANTED);
            return;
        }
        if (req == REQ_LOC && geoCb != null) {
            boolean ok = g.length > 0 && g[0] == PackageManager.PERMISSION_GRANTED;
            geoCb.invoke(geoOrigin, ok, false);
            geoCb = null;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // 点通知回到已经开着的 App：记下是哪条提醒，让网页接着聊
        if (Store.saveLaunch(this, intent)) js("window.__amorLaunch&&window.__amorLaunch()");
        takeShared(intent);
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

    @Override
    protected void onPause() {
        super.onPause();
        js("window.__amorPause&&window.__amorPause()");      // 5.0：动态壁纸在后台停帧
        if (voice != null) voice.onPause();                    // 切到后台就别再听了
        if (mic != null) mic.stop(true);
        if (viz != null) viz.stop();                           // 5.11：后台不读声音
    }

    @Override
    protected void onDestroy() {
        if (voice != null) voice.destroy();
        if (mic != null) mic.stop(false);
        if (viz != null) viz.stop();
        super.onDestroy();
    }

    void js(String code) {
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
