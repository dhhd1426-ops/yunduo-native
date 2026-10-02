/* 5.7 PDF（window.Docs.pdf）：读用 pdf.js（lib/pdf.min.mjs，按需加载），写和改用 pdf-lib（lib/pdf-lib.min.js）。
 * 中文：pdf-lib 自带的标准字体没有汉字，这里自己把 lib/pdf-sc.ttf（思源宋体转成 TrueType 轮廓的子集，SIL OFL）
 * 按这份 PDF 实际用到的字做成子集，嵌成 CID 字体（Identity-H + ToUnicode），文字能选中、能复制，文件也小。
 */
(function () {
  'use strict';
  var P = {}, BASE = window.DOCS_BASE || 'lib/';
  function xhr(url, type) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest(); x.open('GET', url); x.responseType = type || 'arraybuffer';
      x.onload = function () { if (x.status === 0 || (x.status >= 200 && x.status < 300)) res(x.response); else rej({ msg: '读不到 ' + url }); };
      x.onerror = function () { rej({ msg: '读不到 ' + url }); }; x.send();
    });
  }
  var libP = null, jsP = null, fontP = null;
  function pdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = BASE + 'pdf-lib.min.js';
      s.onload = function () { window.PDFLib ? res(window.PDFLib) : rej({ msg: 'PDF 组件没加载好' }); };
      s.onerror = function () { libP = null; rej({ msg: 'PDF 组件没加载好' }); };
      document.head.appendChild(s);
    });
    return libP;
  }
  function pdfjs() {
    if (jsP) return jsP;
    jsP = Promise.all([xhr(BASE + 'pdf.min.mjs', 'text'), xhr(BASE + 'pdf.worker.min.mjs', 'text')]).then(function (t) {
      var mu = URL.createObjectURL(new Blob([t[0]], { type: 'text/javascript' })), wu = URL.createObjectURL(new Blob([t[1]], { type: 'text/javascript' }));
      return import(mu).then(function (m) {
        var lib = m.getDocument ? m : m.default || window.pdfjsLib;
        try { lib.GlobalWorkerOptions.workerPort = new Worker(wu, { type: 'module' }); } catch (e) { lib.GlobalWorkerOptions.workerSrc = wu; }
        return lib;
      });
    });
    jsP.catch(function () { jsP = null; });
    return jsP;
  }
  function cmapUrl() { return new URL(BASE + 'cmaps/', location.href).href; }
  function open(buf) {
    return pdfjs().then(function (lib) {
      return lib.getDocument({ data: new Uint8Array(buf.slice ? buf.slice(0) : buf), cMapUrl: cmapUrl(), cMapPacked: true, isEvalSupported: false, useSystemFonts: true }).promise;
    }).catch(function (e) { throw e && e.msg ? e : { msg: /password/i.test(e && e.name || '') ? '这个 PDF 有密码，打不开' : '这个 PDF 读不了（' + (e && (e.message || e.name) || '格式不对') + '）' }; });
  }
  P.load = pdfjs; P.lib = pdfLib; P.open = open;

  // 一页的文字：按行拼（同一行的字按 x 排），返回 { text, items:[{s,x,y,w,h}] }
  function pageText(pg) {
    return pg.getTextContent().then(function (tc) {
      var items = tc.items.filter(function (i) { return i.str && i.str.trim(); }).map(function (i) { return { s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height || 10 }; });
      var lines = [];
      items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; }).forEach(function (it) {
        var L = lines[lines.length - 1];
        if (L && Math.abs(L.y - it.y) < Math.max(2, it.h * .45)) L.items.push(it); else lines.push({ y: it.y, items: [it] });
      });
      var text = lines.map(function (L) {
        var s = '', px = null;
        L.items.sort(function (a, b) { return a.x - b.x; }).forEach(function (it) { if (px != null && it.x - px > it.h * .9) s += it.x - px > it.h * 3 ? '\t' : ' '; s += it.s; px = it.x + it.w; });
        return s;
      }).join('\n');
      return { text: text, items: items };
    });
  }
  // 读：{ pages, text（带「— 第 n 页 —」）, scanned, fields:[{name,type,value}] }
  P.read = function (buf, opt) {
    opt = opt || {};
    return open(buf).then(function (doc) {
      var n = doc.numPages, want = [];
      var sel = opt.pages ? parsePages(opt.pages, n) : null;
      for (var i = 1; i <= n; i++) if (!sel || sel.indexOf(i) >= 0) want.push(i);
      var info = doc.getMetadata().catch(function () { return {}; });
      return Promise.all(want.map(function (i) { return doc.getPage(i).then(pageText).then(function (t) { return { n: i, text: t.text }; }); })).then(function (pgs) {
        var total = pgs.reduce(function (s, p) { return s + p.text.replace(/\s/g, '').length; }, 0);
        return Promise.all([info, doc.getFieldObjects ? doc.getFieldObjects().catch(function () { return null; }) : null]).then(function (r) {
          var fields = [];
          if (r[1]) Object.keys(r[1]).forEach(function (k) { var f = r[1][k][0] || {}; if (f.type || f.value != null) fields.push({ name: k, type: f.type || '', value: f.value == null ? '' : String(f.value) }); });
          var meta = r[0] && r[0].info || {};
          doc.destroy();
          return { pages: n, title: meta.Title || '', read: pgs.map(function (p) { return p.n; }), scanned: total < 15 * pgs.length, fields: fields,
            text: pgs.map(function (p) { return '— 第 ' + p.n + ' 页 —\n' + p.text; }).join('\n\n') };
        });
      });
    });
  };
  function parsePages(s, n) {
    var out = [];
    String(s).split(/[,，、\s]+/).forEach(function (part) {
      var m = /^(\d+)\s*[-~到至]\s*(\d+|末|end)?$/.exec(part);
      if (m) { var a = +m[1], b = m[2] && /\d/.test(m[2]) ? +m[2] : n; for (var i = a; i <= b; i++) out.push(i); }
      else if (/^\d+$/.test(part)) out.push(+part);
      else if (/^(末|最后|last)/.test(part)) out.push(n);
    });
    return out.filter(function (i) { return i >= 1 && i <= n; });
  }
  P.parsePages = parsePages;
  // 预览：把第 i 页画进 canvas（宽 w 个 CSS 像素）
  P.render = function (doc, i, canvas, w) {
    return doc.getPage(i).then(function (pg) {
      var v0 = pg.getViewport({ scale: 1 }), dpr = Math.min(2, window.devicePixelRatio || 1), sc = w / v0.width, vp = pg.getViewport({ scale: sc * dpr });
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      canvas.style.width = w + 'px'; canvas.style.height = Math.round(vp.height / dpr) + 'px';
      return pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    });
  };

  /* ---------------- 中文字体：解析 TrueType、按用到的字做子集 ---------------- */
  function Font(buf) {
    var dv = new DataView(buf), T = {}, n = dv.getUint16(4);
    for (var i = 0; i < n; i++) { var o = 12 + i * 16, tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); T[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) }; }
    var head = T.head.off, hhea = T.hhea.off;
    this.buf = buf; this.dv = dv; this.T = T;
    this.upm = dv.getUint16(head + 18);
    this.bbox = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)];
    this.longLoca = dv.getInt16(head + 50) === 1;
    this.ascent = dv.getInt16(hhea + 4); this.descent = dv.getInt16(hhea + 6);
    this.numH = dv.getUint16(hhea + 34); this.numG = dv.getUint16(T.maxp.off + 4);
    this.cap = T['OS/2'] && dv.getUint16(T['OS/2'].off) >= 2 ? dv.getInt16(T['OS/2'].off + 88) : this.ascent;
    // cmap（3,1）format 4
    var cm = T.cmap.off, nt = dv.getUint16(cm + 2), sub = -1;
    for (var k = 0; k < nt; k++) { var pid = dv.getUint16(cm + 4 + k * 8), eid = dv.getUint16(cm + 6 + k * 8), so = dv.getUint32(cm + 8 + k * 8); if (pid === 3 && eid === 1 && dv.getUint16(cm + so) === 4) sub = cm + so; }
    this.map = {};
    if (sub >= 0) {
      var seg = dv.getUint16(sub + 6) / 2, ends = sub + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ros = deltas + seg * 2;
      for (var s = 0; s < seg; s++) {
        var e = dv.getUint16(ends + s * 2), st = dv.getUint16(starts + s * 2), d = dv.getInt16(deltas + s * 2), ro = dv.getUint16(ros + s * 2);
        for (var c = st; c <= e && c !== 0xffff; c++) {
          var g = ro === 0 ? (c + d) & 0xffff : dv.getUint16(ros + s * 2 + ro + (c - st) * 2);
          if (ro !== 0 && g) g = (g + d) & 0xffff;
          if (g) this.map[c] = g;
        }
      }
    }
  }
  Font.prototype.gid = function (cp) { return this.map[cp] || 0; };
  Font.prototype.adv = function (g) { var i = Math.min(g, this.numH - 1); return this.dv.getUint16(this.T.hmtx.off + i * 4); };
  Font.prototype.loca = function (g) { var o = this.T.loca.off; return this.longLoca ? this.dv.getUint32(o + g * 4) : this.dv.getUint16(o + g * 2) * 2; };
  Font.prototype.width = function (str, size) { var w = 0; for (var i = 0; i < str.length; i++) { var cp = str.codePointAt(i); if (cp > 0xffff) i++; w += this.adv(this.gid(cp)); } return w * size / this.upm; };
  // 子集：gid 不变（其余字形清空），复合字形带上它引用的部件
  Font.prototype.subset = function (used) {
    var dv = this.dv, gl = this.T.glyf.off, self = this, keep = {}; keep[0] = 1;
    var stack = Object.keys(used).map(Number);
    while (stack.length) {
      var g = stack.pop(); if (keep[g] && g !== 0) continue; keep[g] = 1;
      var a = this.loca(g), b = this.loca(g + 1); if (b <= a) continue;
      if (dv.getInt16(gl + a) < 0) {
        var p = gl + a + 10, fl;
        do { fl = dv.getUint16(p); var cg = dv.getUint16(p + 2); if (!keep[cg]) stack.push(cg); p += 4 + (fl & 1 ? 4 : 2) + (fl & 8 ? 2 : fl & 0x40 ? 4 : fl & 0x80 ? 8 : 0); } while (fl & 0x20);
      }
    }
    var chunks = [], loca = new Uint32Array(this.numG + 1), off = 0, src = new Uint8Array(this.buf);
    for (var i = 0; i < this.numG; i++) {
      loca[i] = off;
      if (keep[i]) { var s0 = this.loca(i), s1 = this.loca(i + 1); if (s1 > s0) { var d = src.subarray(gl + s0, gl + s1), pad = (4 - d.length % 4) % 4; chunks.push(d); if (pad) chunks.push(new Uint8Array(pad)); off += d.length + pad; } }
    }
    loca[this.numG] = off;
    var glyf = new Uint8Array(off), q = 0; chunks.forEach(function (c) { glyf.set(c, q); q += c.length; });
    var locaB = new Uint8Array((this.numG + 1) * 4), lv = new DataView(locaB.buffer); for (var j = 0; j <= this.numG; j++) lv.setUint32(j * 4, loca[j]);
    function copy(tag) { var t = self.T[tag]; return t ? src.slice(t.off, t.off + t.len) : null; }
    var head = copy('head'); new DataView(head.buffer).setInt16(50, 1); new DataView(head.buffer).setUint32(8, 0);
    var tables = { 'OS/2': copy('OS/2'), glyf: glyf, head: head, hhea: copy('hhea'), hmtx: copy('hmtx'), loca: locaB, maxp: copy('maxp') };
    var tags = Object.keys(tables).filter(function (t) { return tables[t]; }).sort(), nt = tags.length, size = 12 + nt * 16;
    tags.forEach(function (t) { size += (tables[t].length + 3) & ~3; });
    var out = new Uint8Array(size), ov = new DataView(out.buffer), es = Math.floor(Math.log2(nt)), sr = Math.pow(2, es) * 16;
    ov.setUint32(0, 0x00010000); ov.setUint16(4, nt); ov.setUint16(6, sr); ov.setUint16(8, es); ov.setUint16(10, nt * 16 - sr);
    var pos = 12 + nt * 16, headAt = 0;
    function sum(u, o, l) { var s = 0, v = new DataView(u.buffer, u.byteOffset); for (var i = 0; i < ((l + 3) & ~3); i += 4) s = (s + (i + 4 <= l ? v.getUint32(o + i) : (u[o + i] << 24 | (u[o + i + 1] || 0) << 16 | (u[o + i + 2] || 0) << 8) >>> 0)) >>> 0; return s; }
    tags.forEach(function (t, i) {
      var d = tables[t], r = 12 + i * 16;
      for (var k = 0; k < 4; k++) ov.setUint8(r + k, t.charCodeAt(k));
      out.set(d, pos); ov.setUint32(r + 4, sum(out, pos, d.length)); ov.setUint32(r + 8, pos); ov.setUint32(r + 12, d.length);
      if (t === 'head') headAt = pos;
      pos += (d.length + 3) & ~3;
    });
    ov.setUint32(headAt + 8, (0xB1B0AFBA - sum(out, 0, out.length)) >>> 0);
    return out;
  };
  function font() {
    if (!fontP) { fontP = xhr(BASE + 'pdf-sc.ttf').then(function (b) { return new Font(b); }); fontP.catch(function () { fontP = null; }); }
    return fontP;
  }
  P.font = font;

  // 一份 PDF 里的中文字体：画字时记下用到的字形，保存前一次性写进 PDF
  function CJK(L, doc, F) {
    this.L = L; this.doc = doc; this.F = F; this.used = {}; this.uni = {};
    this.ref = doc.context.nextRef(); this.name = 'FCJK' + Math.random().toString(36).slice(2, 6);
  }
  CJK.prototype.hex = function (s) {
    var h = '';
    for (var i = 0; i < s.length; i++) {
      var cp = s.codePointAt(i); if (cp > 0xffff) i++;
      var g = this.F.gid(cp); if (!g && cp > 32) g = this.F.gid(0x25a1) || 0;   // 没有的字画成 □
      this.used[g] = 1; this.uni[g] = cp;
      h += ('000' + g.toString(16)).slice(-4);
    }
    return h;
  };
  CJK.prototype.width = function (s, size) { return this.F.width(s, size); };
  CJK.prototype.use = function (page) { page.node.setFontDictionary(this.L.PDFName.of(this.name), this.ref); };
  // 画一行字（x,y 是基线起点，单位 pt）；bold 用描边模拟
  CJK.prototype.draw = function (page, s, x, y, size, color, o) {
    o = o || {}; var L = this.L, c = color || [0.1, 0.1, 0.1];
    this.use(page);
    var ops = [L.pushGraphicsState(), L.beginText(), L.setFontAndSize(this.name, size), L.setFillingRgbColor(c[0], c[1], c[2])];
    if (o.bold) ops.push(L.setStrokingRgbColor(c[0], c[1], c[2]), L.setLineWidth(size * 0.035), L.setTextRenderingMode(L.TextRenderingMode.FillAndOutline));
    if (o.rotate) { var r = o.rotate * Math.PI / 180, co = Math.cos(r), si = Math.sin(r); ops.push(L.setTextMatrix(co, si, -si, co, x, y)); }
    else ops.push(L.moveText(x, y));
    ops.push(L.showText(L.PDFHexString.of(this.hex(s))), L.endText(), L.popGraphicsState());
    page.pushOperators.apply(page, ops);
  };
  CJK.prototype.finish = function () {
    var L = this.L, ctx = this.doc.context, F = this.F, self = this;
    var bytes = F.subset(this.used), fname = 'AMRSUB+NotoSerifSC';
    var ff = ctx.flateStream(bytes, { Length1: bytes.length }), ffRef = ctx.register(ff);
    var sc = 1000 / F.upm;
    var desc = ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: fname, Flags: 4, FontBBox: F.bbox.map(function (v) { return Math.round(v * sc); }), ItalicAngle: 0,
      Ascent: Math.round(F.ascent * sc), Descent: Math.round(F.descent * sc), CapHeight: Math.round(F.cap * sc), StemV: 80, FontFile2: ffRef }));
    var gids = Object.keys(this.used).map(Number).sort(function (a, b) { return a - b; }), W = [];
    gids.forEach(function (g) { W.push(g); W.push([Math.round(F.adv(g) * sc)]); });
    var cid = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: fname, CIDSystemInfo: { Registry: L.PDFString.of('Adobe'), Ordering: L.PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: desc, W: W, CIDToGIDMap: 'Identity', DW: 1000 }));
    var cm = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap', '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
      '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange'];
    for (var i = 0; i < gids.length; i += 100) {
      var part = gids.slice(i, i + 100).filter(function (g) { return self.uni[g]; });
      cm.push(part.length + ' beginbfchar');
      part.forEach(function (g) { var u = self.uni[g], hx = u > 0xffff ? (function () { var v = u - 0x10000; return ('000' + (0xd800 + (v >> 10)).toString(16)).slice(-4) + ('000' + (0xdc00 + (v & 1023)).toString(16)).slice(-4); })() : ('000' + u.toString(16)).slice(-4); cm.push('<' + ('000' + g.toString(16)).slice(-4) + '> <' + hx + '>'); });
      cm.push('endbfchar');
    }
    cm.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
    var tu = ctx.register(ctx.flateStream(new TextEncoder().encode(cm.join('\n'))));
    ctx.assign(this.ref, ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: fname, Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: tu }));
  };
  // 按宽度折行（中文按字断，英文尽量按词断；句读不放行首）
  function wrap(fn, text, maxW) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      if (!para) { out.push(''); return; }
      var toks = para.match(/[A-Za-z0-9@#&_\-.,'’:;/%+=()\[\]!?]+\s*|\s+|[\s\S]/g) || [], line = '', w = 0;
      toks.forEach(function (t) {
        var tw = fn(t);
        if (w + tw > maxW && line) {
          if (/^[，。！？、；：”’」』）》…,.!?;:)]/.test(t) && w + tw < maxW * 1.06) { line += t; out.push(line); line = ''; w = 0; return; }
          if (tw > maxW) { for (var i = 0; i < t.length; i++) { var cw = fn(t[i]); if (w + cw > maxW && line) { out.push(line); line = ''; w = 0; } line += t[i]; w += cw; } return; }
          out.push(line.replace(/\s+$/, '')); line = t.replace(/^\s+/, ''); w = fn(line); return;
        }
        line += t; w += tw;
      });
      out.push(line.replace(/\s+$/, ''));
    });
    return out;
  }
  function clean(s) { return String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2'); }

  // 写：Markdown → PDF（A4；标题、段落、列表、引用、分隔线、表格、页码）
  P.create = function (md, opt) {
    opt = opt || {};
    return Promise.all([pdfLib(), font()]).then(function (r) {
      var L = r[0], F = r[1];
      return L.PDFDocument.create().then(function (doc) {
        var C = new CJK(L, doc, F), W = 595.28, H = 841.89, M = 56, CW = W - 2 * M, page = null, y = 0, pages = [];
        function np() { page = doc.addPage([W, H]); pages.push(page); y = H - M; }
        function need(h) { if (!page || y - h < M + 20) np(); }
        function line(s, size, o) { o = o || {}; need(size * 1.7); C.draw(page, s, M + (o.indent || 0), y - size, size, o.color, o); y -= size * (o.lh || 1.7); }
        function para(text, size, o) { o = o || {}; var ls = wrap(function (t) { return C.width(t, size); }, text, CW - (o.indent || 0) - (o.first ? 0 : 0)); ls.forEach(function (l, i) { line((i === 0 && o.bullet ? o.bullet : '') + l, size, Object.assign({}, o, { indent: (o.indent || 0) + (i > 0 && o.hang ? o.hang : 0) })); }); }
        doc.setTitle(opt.title || '文档'); doc.setCreator('云朵天气 · ' + (opt.author || 'Amor')); doc.setProducer('Amor');
        np();
        var lines = String(md || '').replace(/\r/g, '').split('\n'), i = 0;
        while (i < lines.length) {
          var s = lines[i], m;
          if (/^\s*$/.test(s)) { y -= 6; i++; continue; }
          if ((m = /^(#{1,4})\s+(.*)$/.exec(s))) { var lv = m[1].length, sz = [0, 20, 16, 13.5, 12][lv]; y -= lv === 1 ? 4 : 8; need(sz * 2.2); para(clean(m[2]), sz, { bold: true, color: lv === 1 ? [0.1, 0.12, 0.2] : [0.15, 0.15, 0.18], lh: 1.55 }); y -= lv === 1 ? 8 : 3; i++; continue; }
          if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(s)) { need(16); y -= 6; page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 0.6, color: L.rgb(0.75, 0.75, 0.75) }); y -= 10; i++; continue; }
          if (/^\s*\|.*\|\s*$/.test(s)) {
            var rows = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return clean(c.trim()); })); i++; }
            var nc = Math.max.apply(null, rows.map(function (r) { return r.length; })), cw = CW / nc, fs = 10;
            rows.forEach(function (row, ri) {
              var cells = row.map(function (c) { return wrap(function (t) { return C.width(t, fs); }, c, cw - 10); }), hgt = Math.max.apply(null, cells.map(function (c) { return c.length; })) * fs * 1.5 + 8;
              need(hgt); var top = y;
              if (ri === 0) page.drawRectangle({ x: M, y: top - hgt, width: CW, height: hgt, color: L.rgb(0.94, 0.93, 0.9) });
              for (var c = 0; c < nc; c++) {
                page.drawRectangle({ x: M + c * cw, y: top - hgt, width: cw, height: hgt, borderColor: L.rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
                (cells[c] || []).forEach(function (l, k) { C.draw(page, l, M + c * cw + 5, top - 4 - fs - k * fs * 1.5, fs, null, { bold: ri === 0 }); });
              }
              y = top - hgt;
            });
            y -= 8; continue;
          }
          if ((m = /^(\s*)([-*+•]|\d+[.)、])\s+(.*)$/.exec(s))) { var ind = Math.min(3, Math.floor(m[1].length / 2)) * 14, b = /\d/.test(m[2]) ? m[2].replace(/[)、]/, '.') + ' ' : '• '; para(clean(m[3]), 11, { indent: ind, bullet: b, hang: C.width(b, 11) }); i++; continue; }
          if ((m = /^>\s?(.*)$/.exec(s))) { var y0 = y; para(clean(m[1]), 11, { indent: 14, color: [0.35, 0.35, 0.38] }); page.drawLine({ start: { x: M + 4, y: y0 - 2 }, end: { x: M + 4, y: y + 6 }, thickness: 2, color: L.rgb(0.8, 0.6, 0.5) }); i++; continue; }
          var buf = [s]; i++;
          while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*([-*+•]|\d+[.)、])\s|>|\s*\||\s*(-{3,}|\*{3,})\s*$)/.test(lines[i])) buf.push(lines[i++]);
          para(clean(buf.join('')), 11); y -= 4;
        }
        pages.forEach(function (p, k) { var t = '— ' + (k + 1) + ' —'; C.draw(p, t, (W - C.width(t, 9)) / 2, 30, 9, [0.55, 0.55, 0.55]); });
        C.finish();
        return doc.save({ useObjectStreams: true }).then(function (bytes) { return { bytes: bytes, pages: pages.length }; });
      });
    });
  };

  // 改：ops 按顺序执行 → { bytes, pages, diff, extra:[{name, bytes}] }
  //   delete_pages{pages} / keep_pages{pages} / move_page{from,to} / rotate{pages,degrees} / add_text{page,text,x,y,size,color}
  //   add_note{page,text,near|at} / stamp{pages,text,color} / fill_form{fields} / merge{with: 另一份的 bytes, at} / split{ranges:[..]}（另存几份）
  P.edit = function (bytes, ops, find) {
    return Promise.all([pdfLib(), font()]).then(function (r) {
      var L = r[0], F = r[1];
      return L.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        var C = null, diff = [], extra = [], nonAscii = false, jobs = Promise.resolve();
        function cjk() { if (!C || C.doc !== doc) C = new CJK(L, doc, F); return C; }
        function seal() { if (C && C.doc === doc) C.finish(); C = null; }   // 换文档（重排页）前先把字体写好，复制过去的页才带着字
        function pageAt(n) { var p = doc.getPages()[n - 1]; if (!p) throw { msg: '没有第 ' + n + ' 页（一共 ' + doc.getPageCount() + ' 页）' }; return p; }
        function col(c, d) { if (Array.isArray(c)) return c; var m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (m) { var v = parseInt(m[1], 16); return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; } return { red: [0.78, 0.18, 0.16], 红: [0.78, 0.18, 0.16], blue: [0.16, 0.32, 0.72], 蓝: [0.16, 0.32, 0.72], green: [0.15, 0.55, 0.3], 绿: [0.15, 0.55, 0.3], black: [0.1, 0.1, 0.1], 黑: [0.1, 0.1, 0.1] }[c] || d; }
        function box(page, text, x, yTop, o) {
          var c = cjk(), fs = o.size || 10, w = o.width || 170, ls = wrap(function (t) { return c.width(t, fs); }, text, w - 14), h = ls.length * fs * 1.45 + 12;
          var pw = page.getWidth(); if (x + w > pw - 8) x = pw - 8 - w; if (x < 8) x = 8; if (yTop - h < 8) yTop = h + 8;
          page.drawRectangle({ x: x, y: yTop - h, width: w, height: h, color: L.rgb.apply(null, o.fill || [1, 0.95, 0.69]), borderColor: L.rgb.apply(null, o.border || [0.9, 0.81, 0.35]), borderWidth: 0.8, opacity: 0.96 });
          ls.forEach(function (l, k) { c.draw(page, l, x + 7, yTop - 6 - fs - k * fs * 1.45, fs, o.color || [0.35, 0.29, 0]); });
          return h;
        }
        (ops || []).forEach(function (op) {
          jobs = jobs.then(function () {
            var n = doc.getPageCount();
            if (op.op === 'delete_pages') { var del = parsePages(op.pages, n).sort(function (a, b) { return b - a; }); if (del.length >= n) throw { msg: '不能把页全删了' }; del.forEach(function (p) { doc.removePage(p - 1); }); diff.push(['-', '第 ' + del.slice().reverse().join('、') + ' 页']); return; }
            if (op.op === 'keep_pages' || op.op === 'reorder') {
              seal();
              var keep = parsePages(op.pages || op.order, n); if (!keep.length) throw { msg: '要留下哪几页？' };
              return L.PDFDocument.create().then(function (nd) { return nd.copyPages(doc, keep.map(function (p) { return p - 1; })).then(function (ps) { ps.forEach(function (p) { nd.addPage(p); }); doc = nd; diff.push(['+', (op.op === 'reorder' ? '页序改成 ' : '只留第 ') + keep.join('、') + (op.op === 'reorder' ? '' : ' 页')]); }); });
            }
            if (op.op === 'move_page') { seal(); var fr = +op.from, to = +op.to; var ord = []; for (var i = 1; i <= n; i++) if (i !== fr) ord.push(i); ord.splice(Math.max(0, Math.min(ord.length, to - 1)), 0, fr);
              return L.PDFDocument.create().then(function (nd) { return nd.copyPages(doc, ord.map(function (p) { return p - 1; })).then(function (ps) { ps.forEach(function (p) { nd.addPage(p); }); doc = nd; diff.push(['+', '第 ' + fr + ' 页挪到第 ' + to + ' 页']); }); }); }
            if (op.op === 'rotate') { var rp = parsePages(op.pages || '1-' + n, n), dg = +op.degrees || 90; rp.forEach(function (p) { var pg = pageAt(p); pg.setRotation(L.degrees((pg.getRotation().angle + dg + 360) % 360)); }); diff.push(['+', '第 ' + rp.join('、') + ' 页旋转 ' + dg + '°']); return; }
            if (op.op === 'add_text') {
              var pg1 = pageAt(+op.page || 1), c1 = cjk(), sz = +op.size || 12, x = op.x != null ? +op.x : 0.1, y = op.y != null ? +op.y : 0.9;
              if (x <= 1) x *= pg1.getWidth(); if (y <= 1) y *= pg1.getHeight();
              wrap(function (t) { return c1.width(t, sz); }, op.text, pg1.getWidth() - x - 20).forEach(function (l, k) { c1.draw(pg1, l, x, y - k * sz * 1.4, sz, col(op.color, [0.1, 0.1, 0.1]), { bold: !!op.bold }); });
              diff.push(['+', '第 ' + (op.page || 1) + ' 页 文字「' + String(op.text).slice(0, 30) + '」']); return;
            }
            if (op.op === 'add_note') {
              var pn = +op.page || 1, pg2 = pageAt(pn), pw = pg2.getWidth(), ph = pg2.getHeight(), note = String(op.text || ''), stamp2 = op.sign === false ? '' : '— ' + (op.author || 'Amor') + ' · ' + (new Date().getMonth() + 1) + '月' + new Date().getDate() + '日';
              var pos = Promise.resolve(null);
              if (op.near && find) pos = find(pn, op.near);
              return pos.then(function (hit) {
                var x2, yt;
                if (hit) { x2 = hit.x + hit.w + 10; yt = hit.y + hit.h + 4; }
                else { var at = op.at || 'top-right'; x2 = /left/.test(at) ? 24 : /center/.test(at) ? pw / 2 - 85 : pw - 194; yt = /bottom/.test(at) ? 140 : /middle/.test(at) ? ph / 2 + 40 : ph - 40; }
                box(pg2, note + (stamp2 ? '\n' + stamp2 : ''), x2, yt, {});
                diff.push(['+', '第 ' + pn + ' 页 批注「' + note.slice(0, 30) + '」' + (hit ? '（在「' + op.near + '」旁边）' : op.near ? '（没找到「' + op.near + '」，放在右上角）' : '')]);
              });
            }
            if (op.op === 'stamp') {
              var sp = parsePages(op.pages || '1', n), t = String(op.text || '已审阅'), cc = col(op.color, [0.78, 0.18, 0.16]);
              sp.forEach(function (p) { var pg3 = pageAt(p), c3 = cjk(), fs3 = 22, tw = c3.width(t, fs3), bw = tw + 28, bh = 40, bx = pg3.getWidth() - bw - 50, by = pg3.getHeight() - 120;
                pg3.drawRectangle({ x: bx, y: by, width: bw, height: bh, borderColor: L.rgb(cc[0], cc[1], cc[2]), borderWidth: 2.2, rotate: L.degrees(-8), opacity: 0.9, borderOpacity: 0.85 });
                var rr = -8 * Math.PI / 180; c3.draw(pg3, t, bx + 14 * Math.cos(rr) + 12 * Math.sin(-rr), by + 14 * Math.sin(rr) + 12 * Math.cos(rr) - 2, fs3, cc, { bold: true, rotate: -8 }); });
              diff.push(['+', '第 ' + sp.join('、') + ' 页 印章「' + t + '」']); return;
            }
            if (op.op === 'fill_form') {
              var form = doc.getForm(), names = form.getFields().map(function (f) { return f.getName(); });
              Object.keys(op.fields || {}).forEach(function (k) {
                var f; try { f = form.getField(k); } catch (e) { throw { msg: '表单里没有「' + k + '」，有这些：' + names.join('、') }; }
                var v = op.fields[k], tn = f.constructor.name;
                if (/TextField/.test(tn)) { f.setText(String(v)); if (/[^\x00-\x7f]/.test(String(v))) nonAscii = true; }
                else if (/CheckBox/.test(tn)) { if (v && v !== 'false' && v !== '否') f.check(); else f.uncheck(); }
                else if (/Dropdown|OptionList/.test(tn)) f.select(String(v));
                else if (/RadioGroup/.test(tn)) f.select(String(v));
                diff.push(['+', '表单「' + k + '」= ' + v]);
              });
              return;
            }
            if (op.op === 'merge') {
              return L.PDFDocument.load(op.with, { ignoreEncryption: true }).then(function (od) { return doc.copyPages(od, od.getPageIndices()).then(function (ps) { var at2 = op.at == null ? doc.getPageCount() : +op.at; ps.forEach(function (p, k) { doc.insertPage(at2 + k, p); }); diff.push(['+', '合并了「' + (op.name || '另一份') + '」' + ps.length + ' 页']); }); });
            }
            if (op.op === 'split') {
              seal();
              return (op.ranges || []).reduce(function (pr, rg) { return pr.then(function () { var ps2 = parsePages(rg, n); return L.PDFDocument.create().then(function (nd) { return nd.copyPages(doc, ps2.map(function (p) { return p - 1; })).then(function (cp) { cp.forEach(function (p) { nd.addPage(p); }); return nd.save(); }).then(function (b) { extra.push({ range: rg, bytes: b, pages: ps2.length }); diff.push(['+', '拆出第 ' + rg + ' 页']); }); }); }); }, Promise.resolve());
            }
            throw { msg: '不认识的 PDF 操作：' + op.op };
          });
        });
        return jobs.then(function () {
          if (C && C.doc !== doc) C = null;
          if (C) C.finish();
          if (nonAscii) try { doc.getForm().acroForm.dict.set(L.PDFName.of('NeedAppearances'), L.PDFBool.True); } catch (e) {}
          return doc.save({ updateFieldAppearances: !nonAscii }).then(function (b) { return { bytes: b, pages: doc.getPageCount(), diff: diff, extra: extra }; });
        });
      });
    });
  };
  // 在第 n 页找一段字的位置（给批注定位）
  P.finder = function (bytes) {
    var dp = null;
    return function (n, needle) {
      if (!dp) dp = open(bytes);
      return dp.then(function (doc) { return doc.getPage(n).then(pageText); }).then(function (t) {
        var s = String(needle).replace(/\s/g, '');
        var hit = t.items.filter(function (i) { return i.s.replace(/\s/g, '').indexOf(s) >= 0; })[0] || t.items.filter(function (i) { return s.indexOf(i.s.replace(/\s/g, '')) >= 0 && i.s.trim().length > 1; })[0];
        return hit || null;
      }).catch(function () { return null; });
    };
  };

  window.Docs = window.Docs || {};
  window.Docs.pdf = P;
})();
