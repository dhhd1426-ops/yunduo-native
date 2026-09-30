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
import android.view.Window;
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
    static final int REQ_FILE = 41, REQ_WALL = 42, REQ_LOC = 43, REQ_WMIC = 46, REQ_CAM = 48;
    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private GeolocationPermissions.Callback geoCb;
    private String geoOrigin;
    private Uri photoUri;              // 5.7：+ 面板「相机」拍的那张
    private PermissionRequest micReq;   // 5.5：网页要麦克风（语音模式自己录音、云端识别）
    Voice voice;                 // 5.4：麦克风听写 / 语音模式 / 系统朗读兜底
    Mic mic;                     // 5.5.2：语音对话的原生录音（通话模式，带回声消除）

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
                    Intent i = p.createIntent();
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(i, REQ_FILE);
                } catch (Throwable t) {
                    fileCb = null;
                    Store.err(MainActivity.this, "chooser", t);
                    return false;
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
        Store.saveLaunch(this, getIntent());
        takeShared(getIntent());
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
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
            if (fileCb != null) fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
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
    }

    @Override
    protected void onDestroy() {
        if (voice != null) voice.destroy();
        if (mic != null) mic.stop(false);
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
