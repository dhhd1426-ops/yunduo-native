/* 云朵天气 · 壁纸运行时。资源质量与运行调度分开：不压缩、不缩图、不删特效。 */
function __wallRuntimeFactory() {
  'use strict';
  function FramePipe(send) { this.send = send; this.seq = 0; this.pending = 0; this.next = null; this.submitted = 0; this.coalesced = 0; }
  FramePipe.prototype.discard = function () { if (this.next && this.next.bmp && this.next.bmp.close) this.next.bmp.close(); this.next = null; };
  FramePipe.prototype.push = function (frame) {
    if (this.pending) { if (this.next) this.coalesced++; this.discard(); this.next = frame; return; }
    frame.frameId = ++this.seq; this.pending = frame.frameId; this.submitted++;
    this.send(frame);
  };
  FramePipe.prototype.ack = function (id, active) {
    if (!id || id !== this.pending) return false;
    this.pending = 0;
    var next = this.next; this.next = null;
    if (next && active) this.push(next); else if (next && next.bmp && next.bmp.close) next.bmp.close();
    return true;
  };
  FramePipe.prototype.reset = function () { this.pending = 0; this.discard(); };
  function Clock() { this.time = 0; this.last = null; }
  Clock.prototype.step = function (now, rate) {
    if (this.last != null) this.time += Math.max(0, Math.min(.25, (now - this.last) / 1000)) * rate;
    this.last = now; return this.time;
  };
  Clock.prototype.pause = function () { this.last = null; };
  // 同一时刻只允许少量解码占用内存；在 GPU 上传完成后释放该任务的槽位。
  function AssetPool(limit) { this.limit = limit || 2; this.active = 0; this.wait = []; this.peak = 0; }
  AssetPool.prototype.run = function (fn) {
    var self = this;
    return new Promise(function (ok, no) { self.wait.push({ fn: fn, ok: ok, no: no }); self.pump(); });
  };
  AssetPool.prototype.pump = function () {
    var self = this;
    while (self.active < self.limit && self.wait.length) {
      (function (job) {
        self.active++; self.peak = Math.max(self.peak, self.active);
        Promise.resolve().then(job.fn).then(function (v) { self.active--; job.ok(v); self.pump(); }, function (e) { self.active--; job.no(e); self.pump(); });
      })(self.wait.shift());
    }
  };
  return { FramePipe: FramePipe, Clock: Clock, AssetPool: AssetPool };
}
var WallRuntime = __wallRuntimeFactory();
if (typeof module !== 'undefined' && module.exports) module.exports = WallRuntime;
