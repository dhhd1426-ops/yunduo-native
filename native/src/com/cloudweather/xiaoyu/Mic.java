package com.cloudweather.xiaoyu;

import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.util.Base64;

import org.json.JSONObject;

/**
 * 5.5.2：语音对话的原生录音。
 * 网页的 getUserMedia 在有的手机上开不起来，这里直接用 AudioRecord 录 16 kHz 单声道 PCM，
 * 每 50ms 一块（800 个采样）转 base64 交给网页 window.__mic(b64)；状态走 window.__micEv({t:'open'|'err'|'stop'})。
 * 音源用 VOICE_COMMUNICATION（通话模式）：系统自带回声消除，她在外放朗读时你开口也能听清、不容易被她自己的声音打断。
 */
class Mic {
    static final int REQ_NMIC = 47;
    private static final int RATE = 16000, BLOCK = 800;
    private final MainActivity act;
    private AudioRecord rec;
    private AcousticEchoCanceler aec;
    private NoiseSuppressor ns;
    private Thread th;
    private volatile boolean run;
    private volatile int gen;
    private boolean pend;

    Mic(MainActivity a) { act = a; }

    private void ev(String t, String k, Object v) {
        try {
            JSONObject o = new JSONObject().put("t", t);
            if (k != null) o.put(k, v);
            act.js("window.__micEv&&window.__micEv(" + o.toString() + ")");
        } catch (Throwable ignore) { }
    }

    boolean aecAvailable() { try { return AcousticEchoCanceler.isAvailable(); } catch (Throwable t) { return false; } }

    void start() {
        if (act.voice != null && !act.voice.hasMic()) {
            pend = true;
            act.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_NMIC);
            return;
        }
        open();
    }

    void onPermission(boolean ok) {
        if (!pend) return;
        pend = false;
        if (ok) open(); else ev("err", "code", "perm");
    }

    private void open() {
        stop(false);
        try {
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, BLOCK * 2 * 8));
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
                try { rec.release(); } catch (Throwable ignore) { }
                rec = null;
                ev("err", "code", "init");
                return;
            }
            boolean hasAec = false;
            try {
                if (AcousticEchoCanceler.isAvailable()) { aec = AcousticEchoCanceler.create(rec.getAudioSessionId()); if (aec != null) { aec.setEnabled(true); hasAec = aec.getEnabled(); } }
                if (NoiseSuppressor.isAvailable()) { ns = NoiseSuppressor.create(rec.getAudioSessionId()); if (ns != null) ns.setEnabled(true); }
            } catch (Throwable ignore) { }
            rec.startRecording();
            if (rec.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) { stop(false); ev("err", "code", "busy"); return; }
            run = true;
            final int my = ++gen;
            final AudioRecord r = rec;
            th = new Thread(new Runnable() {
                @Override public void run() {
                    short[] buf = new short[BLOCK];
                    byte[] bb = new byte[BLOCK * 2];
                    while (run && my == gen) {
                        int n;
                        try { n = r.read(buf, 0, BLOCK); } catch (Throwable t) { n = -1; }
                        if (n < 0) {
                            if (run && my == gen) act.runOnUiThread(new Runnable() { @Override public void run() { ev("err", "code", "read"); } });
                            break;
                        }
                        if (n == 0) continue;
                        for (int i = 0; i < n; i++) { bb[i * 2] = (byte) (buf[i] & 0xff); bb[i * 2 + 1] = (byte) ((buf[i] >> 8) & 0xff); }
                        final String b64 = Base64.encodeToString(bb, 0, n * 2, Base64.NO_WRAP);
                        act.runOnUiThread(new Runnable() { @Override public void run() { if (run && my == gen) act.js("window.__mic&&window.__mic('" + b64 + "')"); } });
                    }
                }
            }, "amor-mic");
            th.start();
            ev("open", "aec", hasAec);
        } catch (Throwable t) {
            Store.err(act, "micOpen", t);
            stop(false);
            ev("err", "code", "open");
        }
    }

    void stop(boolean tell) {
        boolean was = run || rec != null;
        run = false; gen++;
        try { if (rec != null) { try { rec.stop(); } catch (Throwable ignore) { } rec.release(); } } catch (Throwable ignore) { }
        rec = null;
        try { if (aec != null) aec.release(); } catch (Throwable ignore) { }
        try { if (ns != null) ns.release(); } catch (Throwable ignore) { }
        aec = null; ns = null; th = null;
        if (tell && was) ev("stop", null, null);
    }
}
