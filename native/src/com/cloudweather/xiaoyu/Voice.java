package com.cloudweather.xiaoyu;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.speech.RecognitionService;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

/**
 * 5.4：回信栏的麦克风和语音模式。
 * 听写用系统的 SpeechRecognizer（小米上是小爱/系统语音服务）；没有的话退回系统的「语音输入」弹窗。
 * 朗读的兜底用系统 TextToSpeech（火山朗读失败时网页会改用这里）。
 * 所有结果都通过 window.__stt({t:...}) 交回网页。所有方法都在主线程跑。
 */
class Voice {
    static final int REQ_MIC = 44, REQ_STT = 45;
    private final MainActivity act;
    private SpeechRecognizer sr;
    private TextToSpeech tts;
    private boolean ttsReady;
    private String pendLang;       // 等麦克风权限期间要开始的听写
    private boolean pendIntent;

    Voice(MainActivity a) { act = a; }

    boolean hasMic() {
        return Build.VERSION.SDK_INT < 23 || act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    boolean available() {
        try { return SpeechRecognizer.isRecognitionAvailable(act); } catch (Throwable t) { return false; }
    }

    private void emit(JSONObject o) {
        act.js("window.__stt&&window.__stt(" + o.toString() + ")");
    }

    private void emit(String type, String k, Object v) {
        try {
            JSONObject o = new JSONObject().put("t", type);
            if (k != null) o.put(k, v);
            emit(o);
        } catch (Throwable ignore) { }
    }

    private static String tag(String lang) { return lang == null || lang.length() == 0 ? "zh-CN" : lang; }

    // 5.5：错误 5（ERROR_CLIENT）的修法——
    //  ① 每次听写一个编号 gen，旧识别器取消后晚到的回调（常常就是一个 5）一律丢掉，不再串到新的一轮；
    //  ② 上一个识别器刚关掉时等 300ms 再建新的（识别服务还没解绑完就连上，也会报 5 / 8）；
    //  ③ 还没听到声音就报 5 / 8：悄悄重试，第二次不带语言参数（有的识别服务不认 zh-CN 也报 5）。
    private final Handler h = new Handler(Looper.getMainLooper());
    private int gen = 0, retries = 0;
    private long lastEnd = 0;
    private boolean heard;

    /** 开始听写；没权限先要权限 */
    void start(String lang) {
        if (!hasMic()) {
            pendLang = tag(lang); pendIntent = false;
            act.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            return;
        }
        if (!available()) { startIntent(lang); return; }
        retries = 0;
        begin(lang, 0);
    }

    private void begin(final String lang, long delay) {
        final int my = ++gen;
        if (sr != null) { stopQuiet(); lastEnd = SystemClock.uptimeMillis(); }
        long gap = 300 - (SystemClock.uptimeMillis() - lastEnd);
        long d = Math.max(delay, Math.max(0, gap));
        if (d <= 0) open(lang, my);
        else h.postDelayed(new Runnable() { @Override public void run() { if (my == gen) open(lang, my); } }, d);
    }

    private void open(final String lang, final int my) {
        try {
            heard = false;
            final SpeechRecognizer me = SpeechRecognizer.createSpeechRecognizer(act);
            sr = me;
            me.setRecognitionListener(new RecognitionListener() {
                private boolean live() { return me == sr && my == gen; }
                @Override public void onReadyForSpeech(Bundle b) { if (live()) emit("ready", null, null); }
                @Override public void onBeginningOfSpeech() { if (live()) { heard = true; emit("begin", null, null); } }
                @Override public void onRmsChanged(float db) { if (live()) emit("rms", "v", (double) db); }
                @Override public void onBufferReceived(byte[] b) { }
                @Override public void onEndOfSpeech() { if (live()) emit("eos", null, null); }
                @Override public void onError(int code) {
                    if (!live()) return;
                    if ((code == SpeechRecognizer.ERROR_CLIENT || code == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) && !heard && retries < 2) {
                        retries++;
                        Store.err(act, "sttRetry", new Exception("code " + code + " retry " + retries));
                        begin(retries >= 2 ? "" : lang, 450);
                        return;
                    }
                    finish();
                    emit("err", "code", code);
                }
                @Override public void onResults(Bundle b) { if (!live()) return; finish(); emit("final", "text", first(b)); }
                @Override public void onPartialResults(Bundle b) { if (live()) emit("part", "text", first(b)); }
                @Override public void onEvent(int e, Bundle b) { }
            });
            Intent i = lang == null || lang.length() == 0 ? recIntentAny() : recIntent(lang);
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            // 停顿多久算说完：语音模式里给得宽一点，别一口气没说完就发出去
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
            me.startListening(i);
        } catch (Throwable t) {
            Store.err(act, "sttStart", t);
            emit("err", "code", -1);
        }
    }

    /** 这一轮结束（出结果或出错）：识别器留到下一轮再关，但记下时间，下一轮隔够 300ms */
    private void finish() {
        gen++;
        final SpeechRecognizer me = sr;
        sr = null;
        lastEnd = SystemClock.uptimeMillis();
        if (me != null) h.post(new Runnable() { @Override public void run() { try { me.destroy(); } catch (Throwable ignore) { } } });
    }

    private Intent recIntentAny() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, act.getPackageName());
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        return i;
    }

    /** 诊断：默认用的是哪个识别服务、装了几个 */
    JSONObject info() {
        JSONObject o = new JSONObject();
        try {
            o.put("svc", String.valueOf(Settings.Secure.getString(act.getContentResolver(), "voice_recognition_service")));
            java.util.List<?> l = act.getPackageManager().queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE), 0);
            o.put("svcs", l == null ? 0 : l.size());
            o.put("retries", retries);
        } catch (Throwable ignore) { }
        return o;
    }

    private Intent recIntent(String lang) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag(lang));
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, tag(lang));
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, act.getPackageName());
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        return i;
    }

    /** 没有后台识别服务：打开系统的「语音输入」弹窗 */
    void startIntent(String lang) {
        try {
            Intent i = recIntent(lang);
            i.putExtra(RecognizerIntent.EXTRA_PROMPT, "说吧，我在听");
            if (i.resolveActivity(act.getPackageManager()) == null) { emit("err", "code", -2); return; }
            emit("dialog", null, null);
            act.startActivityForResult(i, REQ_STT);
        } catch (Throwable t) {
            Store.err(act, "sttIntent", t);
            emit("err", "code", -2);
        }
    }

    void onActivityResult(int res, Intent data) {
        String s = "";
        if (res == android.app.Activity.RESULT_OK && data != null) {
            ArrayList<String> r = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (r != null && r.size() > 0) s = r.get(0);
        }
        if (s.length() > 0) emit("final", "text", s);
        else emit("err", "code", SpeechRecognizer.ERROR_NO_MATCH);
    }

    void onPermission(boolean ok) {
        String l = pendLang; pendLang = null;
        if (l == null) return;
        if (!ok) { emit("err", "code", SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS); return; }
        if (pendIntent) startIntent(l); else start(l);
    }

    private static String first(Bundle b) {
        if (b == null) return "";
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return r != null && r.size() > 0 && r.get(0) != null ? r.get(0) : "";
    }

    /** 说完了，要最终结果 */
    void stop() {
        try { if (sr != null) sr.stopListening(); } catch (Throwable t) { Store.err(act, "sttStop", t); }
    }

    private void stopQuiet() {
        try { if (sr != null) { sr.cancel(); sr.destroy(); } } catch (Throwable ignore) { }
        sr = null;
    }

    /** 切到后台：正在后台听写就取消（系统语音弹窗、权限弹窗也会触发 onPause，那时不动） */
    void onPause() {
        if (sr != null) cancel();
    }

    /** 取消，不要结果 */
    void cancel() {
        gen++;                       // 等着开始的、旧识别器晚到的回调都作废
        if (sr != null) lastEnd = SystemClock.uptimeMillis();
        stopQuiet();
        emit("end", null, null);
    }

    // ---------- 系统朗读（兜底） ----------

    boolean ttsInit() {
        if (tts != null) return ttsReady;
        try {
            tts = new TextToSpeech(act, new TextToSpeech.OnInitListener() {
                @Override public void onInit(int st) {
                    ttsReady = st == TextToSpeech.SUCCESS;
                    if (ttsReady) {
                        try { tts.setLanguage(Locale.SIMPLIFIED_CHINESE); } catch (Throwable ignore) { }
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override public void onStart(String id) { ttsEv("start", id); }
                            @Override public void onDone(String id) { ttsEv("done", id); }
                            @Override public void onError(String id) { ttsEv("err", id); }
                            @Override public void onStop(String id, boolean interrupted) { ttsEv("stop", id); }
                        });
                    }
                    ttsEv(ttsReady ? "ready" : "err", "");
                }
            });
        } catch (Throwable t) {
            Store.err(act, "ttsInit", t);
        }
        return ttsReady;
    }

    private void ttsEv(final String e, final String id) {
        act.runOnUiThread(new Runnable() { @Override public void run() {
            try { emit(new JSONObject().put("t", "tts").put("e", e).put("id", id == null ? "" : id)); } catch (Throwable ignore) { }
        } });
    }

    void speak(String text, float rate, String id) {
        if (!ttsInit()) { ttsEv("err", id); return; }
        try {
            tts.setSpeechRate(rate > 0 ? rate : 1f);
            Bundle p = new Bundle();
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, id);
        } catch (Throwable t) {
            Store.err(act, "ttsSpeak", t);
            ttsEv("err", id);
        }
    }

    void ttsStop() {
        try { if (tts != null) tts.stop(); } catch (Throwable ignore) { }
    }

    void destroy() {
        stopQuiet();
        try { if (tts != null) tts.shutdown(); } catch (Throwable ignore) { }
        tts = null; ttsReady = false;
    }
}
