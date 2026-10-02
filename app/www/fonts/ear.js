/* 5.5 语音对话的「耳朵」：App 自己录音（getUserMedia，开回声消除），
 * 按音量判断有没有人在说话（噪声底自己跟着环境走），把一段一段的话切出来（16 kHz 单声道 PCM），
 * 另外一个「打断」模式：Amor 在读的时候听你有没有开口。
 * 只管声音，不管识别和断句（那些在 index.html 的 Hear 里）。
 *
 * Ear.open() → Promise           打开麦克风（同一次语音模式里一直开着）
 * Ear.listen(h, {keep})           听：h.level(0..1) / h.voice(on, t) / h.seg(Int16Array, {ms, voiced})
 * Ear.barge(h, {hot})             打断：连着出声够久 → h.fire()，之后自动转成 listen（开口那几个字也留着）
 * Ear.flush()                     立刻把正在说的这段切出来
 * Ear.idle() / Ear.close()        不听 / 关麦克风
 * Ear.wav(pcm) → Blob             16 kHz 16 位 WAV
 */
(function () {
  'use strict';
  var OUT = 16000;
  var ctx = null, stream = null, src = null, proc = null, mute = null, opening = null;
  // 5.5.2：安卓上优先用原生录音（AmorNative.micStart → window.__mic(base64 16k PCM)），网页 getUserMedia 只在浏览器里用
  var nat = null;          // {on, pend:{res,rej}, aec}
  var srcKind = '';        // 'native' | 'web'
  function hasNative() { return !!(window.AmorNative && typeof AmorNative.micStart === 'function'); }
  var mode = 'off', H = {}, O = {};
  var ratio = 3, acc = 0, cnt = 0, phase = 0;
  var floor = -60, lastT = 0;
  // 听
  var pre = [], preLen = 0, PRE = OUT * 0.45;        // 开口前留 0.45 秒，不吃掉第一个字
  var seg = null, segLen = 0, voicedMs = 0, inSpeech = false, voiceOn = false, lastVoice = 0, hist = [];
  // 打断
  var run = 0, runVoiced = 0;
  var deafUntil = 0;        // 5.6：她自己「嗯」的时候别当成你在说话

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function b64pcm(b) {
    var bin = atob(b), n = bin.length >> 1, out = new Float32Array(n);
    for (var i = 0; i < n; i++) { var v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8); if (v >= 32768) v -= 65536; out[i] = v / 32768; }
    return out;
  }
  window.__mic = function (b) { if (nat && nat.on) try { onBlock(b64pcm(b), 16000); } catch (e) {} };
  window.__micEv = function (e) {
    if (!nat) return;
    if (typeof e === 'string') try { e = JSON.parse(e); } catch (x) { return; }
    var p = nat.pend;
    if (e.t === 'open') { nat.on = true; nat.aec = !!e.aec; nat.pend = null; if (p) p.res(); return; }
    if (e.t === 'err' || e.t === 'stop') {
      var was = nat.on; nat.on = false; nat.pend = null;
      var m = e.code === 'perm' ? { code: 'perm', msg: '没有麦克风权限：到系统设置 › 应用 › 云朵天气 › 权限 里打开麦克风' } :
        e.code === 'busy' ? { code: 'busy', msg: '麦克风被别的应用占着' } : e.t === 'stop' ? { code: 'stop', msg: '录音停了' } : { code: 'open', msg: '打不开麦克风（' + (e.code || '未知') + '）' };
      if (p) p.rej(m);
      else if (was && H.fail) try { H.fail(m); } catch (x) {}
    }
  };
  function openNative() {
    nat = nat || {};
    if (nat.on) return Promise.resolve();
    if (nat.pend) return nat.pend.pr;
    var pd = {};
    pd.pr = new Promise(function (res, rej) { pd.res = res; pd.rej = rej; });
    nat.pend = pd; srcKind = 'native'; ratio = 1; phase = acc = cnt = 0;
    try { AmorNative.micStart(); } catch (e) { nat.pend = null; return Promise.reject({ code: 'open', msg: '打不开麦克风' }); }
    return pd.pr;
  }
  function open() {
    if (hasNative()) return openNative();
    if (stream && ctx) return Promise.resolve();
    if (opening) return opening;
    srcKind = 'web';
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return Promise.reject({ code: 'nomedia', msg: '这个系统版本不支持网页录音' });
    opening = md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }).then(function (s) {
      stream = s;
      var AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      ratio = ctx.sampleRate / OUT;
      src = ctx.createMediaStreamSource(s);
      proc = ctx.createScriptProcessor(2048, 1, 1);
      mute = ctx.createGain(); mute.gain.value = 0;
      proc.onaudioprocess = function (e) { onBlock(e.inputBuffer.getChannelData(0), ctx.sampleRate); };
      src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
      opening = null;
    }, function (e) {
      opening = null;
      var n = e && e.name;
      throw { code: n === 'NotAllowedError' || n === 'SecurityError' ? 'perm' : n === 'NotFoundError' ? 'nodev' : 'open', msg: n === 'NotAllowedError' ? '没有麦克风权限' : '打不开麦克风' + (n ? '（' + n + '）' : '') };
    });
    return opening;
  }

  function close() {
    mode = 'off'; H = {}; resetListen();
    if (nat && (nat.on || nat.pend)) { nat.on = false; if (nat.pend) { var pp = nat.pend; nat.pend = null; pp.rej({ code: 'cancel', msg: '' }); } try { AmorNative.micStop(); } catch (e) {} }
    try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } } catch (e) {}
    try { if (src) src.disconnect(); } catch (e) {}
    try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { if (ctx && ctx.close) ctx.close(); } catch (e) {}
    ctx = stream = src = proc = mute = null;
  }

  function resetListen() { seg = null; segLen = 0; voicedMs = 0; inSpeech = false; voiceOn = false; hist = []; run = 0; runVoiced = 0; }

  // 48k → 16k：按块平均（够识别用，不引入额外依赖）
  function down(x) {
    var out = new Int16Array(Math.ceil(x.length / ratio) + 2), n = 0;
    for (var i = 0; i < x.length; i++) {
      acc += x[i]; cnt++; phase += 1;
      if (phase >= ratio) {
        phase -= ratio;
        var v = acc / cnt; acc = 0; cnt = 0;
        v = v < -1 ? -1 : v > 1 ? 1 : v;
        out[n++] = v < 0 ? v * 32768 : v * 32767;
      }
    }
    return out.subarray(0, n);
  }

  function onBlock(x, rate) {
    if (mode === 'off' || mode === 'idle') { phase = 0; acc = 0; cnt = 0; return; }
    ratio = rate / OUT;
    var t = now(), dt = x.length / rate * 1000;
    var s = 0; for (var i = 0; i < x.length; i++) s += x[i] * x[i];
    var db = 10 * Math.log(s / x.length + 1e-12) / Math.LN10;
    var pcm = down(x);
    // 噪声底：往下跟得快，往上跟得慢（说话时几乎不动；打断模式下她的回声会慢慢变成底噪）
    var up = mode === 'barge' ? .035 : inSpeech || t < deafUntil ? .002 : .012;
    floor += (db - floor) * (db < floor ? .3 : up);
    if (floor < -85) floor = -85; if (floor > -28) floor = -28;
    var lv = Math.max(0, Math.min(1, (db - floor - 3) / 32));
    if (H.level) try { H.level(lv, db, floor); } catch (e) {}
    lastT = t;

    if (mode === 'barge') {
      var hot = !!O.hot, thr = Math.max(floor + (hot ? 21 : 15), hot ? -40 : -46);
      var v = db > thr;
      pushPre(pcm);
      run += dt; if (v) runVoiced += dt;
      if (!v && runVoiced < 40) { run = 0; runVoiced = 0; }
      if (run > 900) { run *= .5; runVoiced *= .5; }
      if (runVoiced >= (hot ? 380 : 280) && runVoiced / run > .7) {
        var rv = runVoiced;
        run = runVoiced = 0;
        var hb = H; mode = 'listenStart';
        try { if (hb.fire) hb.fire(); } catch (e) {}
        if (mode === 'listenStart') mode = 'listen';
        if (mode === 'listen') { beginSpeech(t); voicedMs = Math.max(voicedMs, rv); }   // 打断前已经说出的那一小截也算有声（短短一声「嗯」不会被当杂音丢掉）
      }
      return;
    }

    // listen
    var thrL = Math.max(floor + 10, -56), voiced = db > thrL && t > deafUntil;
    hist.push(voiced); if (hist.length > 5) hist.shift();
    if (!inSpeech) {
      pushPre(pcm);
      var k = 0; for (var j = 0; j < hist.length; j++) if (hist[j]) k++;
      if (k >= 3) beginSpeech(t);
      return;
    }
    append(pcm);
    if (voiced) { lastVoice = t; voicedMs += dt; if (!voiceOn) { voiceOn = true; if (H.voice) H.voice(true, t); } }
    var sil = t - lastVoice;
    if (voiceOn && sil > 230) { voiceOn = false; if (H.voice) H.voice(false, lastVoice); }
    if (sil > (O.gap || 520) || segLen > OUT * (O.gap ? 12 : 20)) endSeg();
  }

  function pushPre(pcm) {
    pre.push(pcm); preLen += pcm.length;
    while (pre.length > 1 && preLen - pre[0].length > PRE) { preLen -= pre[0].length; pre.shift(); }
  }
  function beginSpeech(t) {
    inSpeech = true; seg = pre.slice(); segLen = preLen; pre = []; preLen = 0; voicedMs = 60; lastVoice = t;
    if (!voiceOn) { voiceOn = true; if (H.voice) H.voice(true, t); }
  }
  function append(pcm) { seg.push(pcm); segLen += pcm.length; }
  function endSeg() {
    var parts = seg, len = segLen, vm = voicedMs;
    inSpeech = false; seg = null; segLen = 0; voicedMs = 0; hist = [];
    if (voiceOn) { voiceOn = false; if (H.voice) H.voice(false, lastVoice); }
    if (!parts || vm < 180) return;                      // 太短：咳嗽、碰桌子
    var out = new Int16Array(len), o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    if (H.seg) try { H.seg(out, { ms: Math.round(len / OUT * 1000), voiced: Math.round(vm) }); } catch (e) {}
  }

  function listen(h, o) {
    var keep = o && o.keep && (mode === 'listenStart' || mode === 'listen');
    H = h || {}; O = o || {};
    if (!keep) { resetListen(); pre = []; preLen = 0; }
    mode = mode === 'listenStart' ? 'listenStart' : 'listen';
  }
  function barge(h, o) { H = h || {}; O = o || {}; resetListen(); mode = 'barge'; }
  function idle() { mode = 'idle'; H = {}; resetListen(); }
  function flush() { if (inSpeech) endSeg(); }
  function deaf(ms) { deafUntil = now() + (ms || 0); }

  function wav(pcm) {
    var b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, OUT, true); v.setUint32(28, OUT * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    new Int16Array(b, 44).set(pcm);
    return new Blob([b], { type: 'audio/wav' });
  }

  window.Ear = {
    open: open, close: close, listen: listen, barge: barge, idle: idle, flush: flush, wav: wav, deaf: deaf,
    supported: function () { return hasNative() || !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    isOpen: function () { return nat && srcKind === 'native' ? !!nat.on : !!stream; },
    source: function () { return srcKind === 'native' ? (nat && nat.aec ? '系统录音 · 回声消除' : '系统录音') : srcKind === 'web' ? '网页录音' : ''; },
    mode: function () { return mode; },
    speaking: function () { return inSpeech; },
    stats: function () { return { floor: floor, mode: mode, inSpeech: inSpeech, voiceOn: voiceOn }; }
  };
})();
