/* 5.7 文档底座（window.Docs）：表格（.xlsx / .csv，公式计算）、Word 文字、PDF（读：pdf.js；写/改：pdf-lib + 自带中文字体子集）。
 * 只管文件内容，不管界面和对话（那些在 index.html）。所有函数都返回 Promise 或纯数据。
 *
 * 表格模型：{ sheets: [{ name, cells: { A1: { v: 值, f: '公式（不带 =）' } }, merges: ['A1:B2'], widths: {A: 12} }] }
 *   v 是数字 / 字符串 / 布尔；公式格的 v 是算出来的结果。
 */
(function () {
  'use strict';
  var D = {};

  /* ---------------- zip ---------------- */
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xffffffff; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject({ msg: '这个系统版本解不开压缩的文件' });
    var ds = new DecompressionStream('deflate-raw');
    var out = new Blob([u8]).stream().pipeThrough(ds);
    return new Response(out).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    var out = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Response(out).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return null; });
  }
  // 解压整个 zip：{ 名字: Uint8Array }
  function unzip(buf) {
    var u = new Uint8Array(buf), v = new DataView(u.buffer, u.byteOffset, u.byteLength), eocd = -1;
    for (var i = u.length - 22; i >= Math.max(0, u.length - 70000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Promise.reject({ msg: '不是有效的压缩文件（表格 / Word 文件坏了？）' });
    var n = v.getUint16(eocd + 10, true), p = v.getUint32(eocd + 16, true), jobs = [], out = {}, dec = new TextDecoder();
    for (var k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      var meth = v.getUint16(p + 10, true), csz = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      var name = dec.decode(u.subarray(p + 46, p + 46 + nl));
      var ds = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), data = u.subarray(ds, ds + csz);
      (function (name, meth, data) {
        if (meth === 0) out[name] = data;
        else if (meth === 8) jobs.push(inflateRaw(data).then(function (d) { out[name] = d; }));
      })(name, meth, data);
      p += 46 + nl + el + cl;
    }
    return Promise.all(jobs).then(function () { return out; });
  }
  // 打包（能压就压）：entries = [{ name, data: Uint8Array | text }]
  function zip(entries, mime) {
    var enc = new TextEncoder();
    return Promise.all(entries.map(function (e) {
      var data = e.data instanceof Uint8Array ? e.data : enc.encode(e.text || '');
      return deflateRaw(data).then(function (c) { return { name: enc.encode(e.name), data: data, comp: c && c.length < data.length ? c : null }; });
    })).then(function (L) {
      var parts = [], cen = [], off = 0;
      function u16(x) { return [x & 255, (x >>> 8) & 255]; } function u32(x) { return [x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255]; }
      L.forEach(function (e) {
        var crc = crc32(e.data), body = e.comp || e.data, m = e.comp ? 8 : 0;
        var head = [].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(m), u16(0), u16(0x21), u32(crc), u32(body.length), u32(e.data.length), u16(e.name.length), u16(0));
        parts.push(new Uint8Array(head), e.name, body);
        cen.push(new Uint8Array([].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(m), u16(0), u16(0x21), u32(crc), u32(body.length), u32(e.data.length), u16(e.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), e.name);
        off += head.length + e.name.length + body.length;
      });
      var cs = cen.reduce(function (s, x) { return s + x.length; }, 0);
      return new Blob(parts.concat(cen, [new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(L.length), u16(L.length), u32(cs), u32(off), u16(0)))]), { type: mime || 'application/zip' });
    });
  }
  D.unzip = unzip; D.zip = zip;

  /* ---------------- 单元格地址 ---------------- */
  function colNum(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
  function colName(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
  function parseRef(r) { var m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(String(r).toUpperCase()); return m ? { c: colNum(m[1]), r: +m[2] } : null; }
  function refName(c, r) { return colName(c) + r; }
  function parseRange(s) {
    var p = String(s).toUpperCase().split(':'), a = parseRef(p[0]), b = parseRef(p[1] || p[0]);
    if (!a || !b) return null;
    return { c1: Math.min(a.c, b.c), r1: Math.min(a.r, b.r), c2: Math.max(a.c, b.c), r2: Math.max(a.r, b.r) };
  }
  function bounds(sh) {
    var mc = 0, mr = 0;
    Object.keys(sh.cells).forEach(function (k) { var p = parseRef(k); if (p) { if (p.c > mc) mc = p.c; if (p.r > mr) mr = p.r; } });
    return { cols: mc, rows: mr };
  }
  D.colName = colName; D.colNum = colNum; D.parseRef = parseRef; D.parseRange = parseRange; D.bounds = bounds; D.refName = refName;

  /* ---------------- 公式 ---------------- */
  var ERR = function (c) { return { err: c }; };
  function isErr(x) { return x && typeof x === 'object' && x.err; }
  function tokenize(s) {
    var t = [], i = 0, m;
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') { var j = i + 1, str = ''; while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') { str += '"'; j += 2; continue; } break; } str += s[j++]; } t.push({ k: 'str', v: str }); i = j + 1; continue; }
      if ((m = /^('([^']|'')+'|[A-Za-z_一-龥][\w一-龥.]*)!(\$?[A-Za-z]{1,3}\$?\d+(:\$?[A-Za-z]{1,3}\$?\d+)?)/.exec(s.slice(i)))) {
        var sn = m[1].replace(/^'|'$/g, '').replace(/''/g, "'"); t.push({ k: 'ref', sheet: sn, v: m[3].replace(/\$/g, '').toUpperCase() }); i += m[0].length; continue;
      }
      if ((m = /^\$?[A-Za-z]{1,3}\$?\d+(:\$?[A-Za-z]{1,3}\$?\d+)?/.exec(s.slice(i))) && !/^[A-Za-z]+\(/.test(s.slice(i))) { t.push({ k: 'ref', v: m[0].replace(/\$/g, '').toUpperCase() }); i += m[0].length; continue; }
      if ((m = /^\d+(\.\d+)?([eE][+-]?\d+)?%?/.exec(s.slice(i)))) { var num = parseFloat(m[0]); if (/%$/.test(m[0])) num /= 100; t.push({ k: 'num', v: num }); i += m[0].length; continue; }
      if ((m = /^(TRUE|FALSE)\b/i.exec(s.slice(i)))) { t.push({ k: 'bool', v: /^t/i.test(m[1]) }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][A-Za-z0-9_.]*(?=\s*\()/.exec(s.slice(i)))) { t.push({ k: 'fn', v: m[0].toUpperCase() }); i += m[0].length; continue; }
      if ((m = /^(<=|>=|<>|[-+*/^&=<>(),:%;])/.exec(s.slice(i)))) { t.push({ k: 'op', v: m[0] === ';' ? ',' : m[0] }); i += m[0].length; continue; }
      throw ERR('#NAME?');
    }
    return t;
  }
  function parseFormula(src) {
    var t = tokenize(src), p = 0;
    function peek() { return t[p]; } function eat(v) { var x = t[p]; if (x && x.k === 'op' && x.v === v) { p++; return true; } return false; }
    function cmp() { var l = cat(); for (;;) { var x = peek(); if (x && x.k === 'op' && /^(=|<>|<|>|<=|>=)$/.test(x.v)) { p++; l = { op: x.v, a: l, b: cat() }; } else return l; } }
    function cat() { var l = add(); while (eat('&')) l = { op: '&', a: l, b: add() }; return l; }
    function add() { var l = mul(); for (;;) { var x = peek(); if (x && x.k === 'op' && (x.v === '+' || x.v === '-')) { p++; l = { op: x.v, a: l, b: mul() }; } else return l; } }
    function mul() { var l = pow(); for (;;) { var x = peek(); if (x && x.k === 'op' && (x.v === '*' || x.v === '/')) { p++; l = { op: x.v, a: l, b: pow() }; } else return l; } }
    function pow() { var l = un(); while (eat('^')) l = { op: '^', a: l, b: un() }; return l; }
    function un() { if (eat('-')) return { op: 'neg', a: un() }; if (eat('+')) return un(); var v = prim(); while (eat('%')) v = { op: '/', a: v, b: { k: 'num', v: 100 } }; return v; }
    function prim() {
      var x = t[p++]; if (!x) throw ERR('#VALUE!');
      if (x.k === 'num' || x.k === 'str' || x.k === 'bool') return x;
      if (x.k === 'ref') return x;
      if (x.k === 'fn') { eat('('); var args = []; if (!eat(')')) { do { args.push(peek() && peek().k === 'op' && (peek().v === ',' || peek().v === ')') ? { k: 'blank' } : cmp()); } while (eat(',')); if (!eat(')')) throw ERR('#VALUE!'); } return { fn: x.v, args: args }; }
      if (x.k === 'op' && x.v === '(') { var e = cmp(); if (!eat(')')) throw ERR('#VALUE!'); return e; }
      throw ERR('#VALUE!');
    }
    var e = cmp(); if (p < t.length) throw ERR('#VALUE!');
    return e;
  }
  function num(x) {
    if (isErr(x)) return x;
    if (Array.isArray(x)) x = x[0];
    if (typeof x === 'number') return x; if (typeof x === 'boolean') return x ? 1 : 0;
    if (x == null || x === '') return 0;
    var n = Number(String(x).replace(/,/g, '')); return isNaN(n) ? ERR('#VALUE!') : n;
  }
  function str(x) { if (Array.isArray(x)) x = x[0]; if (x == null) return ''; if (typeof x === 'boolean') return x ? 'TRUE' : 'FALSE'; if (typeof x === 'number') return fmtNum(x); return String(x); }
  function fmtNum(n) { return Number.isInteger(n) ? String(n) : String(+n.toPrecision(12)); }
  function flat(args) { var o = []; args.forEach(function (a) { if (Array.isArray(a)) a.forEach(function (r) { if (Array.isArray(r)) r.forEach(function (v) { o.push({ v: v, ref: 1 }); }); else o.push({ v: r, ref: 1 }); }); else o.push({ v: a, ref: 0 }); }); return o; }
  function nums(args) { return flat(args).filter(function (x) { return x.ref ? typeof x.v === 'number' : x.v !== '' && x.v != null; }).map(function (x) { return num(x.v); }); }
  function crit(c) {
    var s = str(c), m = /^(<=|>=|<>|=|<|>)?(.*)$/.exec(s), op = m[1] || '=', val = m[2], nv = Number(val), isn = val !== '' && !isNaN(nv);
    var re = !isn && /[*?]/.test(val) ? new RegExp('^' + val.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
    return function (x) {
      if (isn && typeof x !== 'number' && (x === '' || isNaN(Number(x)))) return op === '<>';
      var a = isn ? Number(x) : String(x == null ? '' : x).toLowerCase(), b = isn ? nv : val.toLowerCase();
      if (re && op === '=') return re.test(String(x)); if (re && op === '<>') return !re.test(String(x));
      return op === '=' ? a === b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
    };
  }
  function round(n, d, mode) { var f = Math.pow(10, d); var x = n * f; x = mode === 'up' ? (x < 0 ? Math.floor(x) : Math.ceil(x)) : mode === 'down' ? (x < 0 ? Math.ceil(x) : Math.floor(x)) : Math.round(x + (x > 0 ? 1e-9 : -1e-9)); return x / f; }
  var FN = {
    SUM: function (a) { return nums(a).reduce(function (s, x) { return isErr(s) ? s : isErr(x) ? x : s + x; }, 0); },
    AVERAGE: function (a) { var n = nums(a); if (!n.length) return ERR('#DIV/0!'); var s = FN.SUM(a); return isErr(s) ? s : s / n.length; },
    MIN: function (a) { var n = nums(a); return n.length ? Math.min.apply(null, n) : 0; },
    MAX: function (a) { var n = nums(a); return n.length ? Math.max.apply(null, n) : 0; },
    MEDIAN: function (a) { var n = nums(a).sort(function (x, y) { return x - y; }); if (!n.length) return ERR('#NUM!'); var m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
    PRODUCT: function (a) { return nums(a).reduce(function (s, x) { return s * x; }, 1); },
    COUNT: function (a) { return flat(a).filter(function (x) { return typeof x.v === 'number'; }).length; },
    COUNTA: function (a) { return flat(a).filter(function (x) { return x.v !== '' && x.v != null; }).length; },
    COUNTBLANK: function (a) { return flat(a).filter(function (x) { return x.v === '' || x.v == null; }).length; },
    ABS: function (a) { return Math.abs(num(a[0])); }, INT: function (a) { return Math.floor(num(a[0])); }, SQRT: function (a) { var n = num(a[0]); return n < 0 ? ERR('#NUM!') : Math.sqrt(n); },
    MOD: function (a) { var d = num(a[1]); return d === 0 ? ERR('#DIV/0!') : num(a[0]) - d * Math.floor(num(a[0]) / d); },
    POWER: function (a) { return Math.pow(num(a[0]), num(a[1])); },
    ROUND: function (a) { return round(num(a[0]), a.length > 1 ? num(a[1]) : 0); },
    ROUNDUP: function (a) { return round(num(a[0]), a.length > 1 ? num(a[1]) : 0, 'up'); },
    ROUNDDOWN: function (a) { return round(num(a[0]), a.length > 1 ? num(a[1]) : 0, 'down'); },
    IF: null, IFERROR: null, AND: function (a) { return flat(a).every(function (x) { return !!num(x.v); }); }, OR: function (a) { return flat(a).some(function (x) { return !!num(x.v); }); }, NOT: function (a) { return !num(a[0]); },
    CONCAT: function (a) { return flat(a).map(function (x) { return str(x.v); }).join(''); }, CONCATENATE: function (a) { return FN.CONCAT(a); },
    TEXTJOIN: function (a) { var sep = str(a[0]), skip = !!num(a[1]); return flat(a.slice(2)).map(function (x) { return str(x.v); }).filter(function (x) { return !skip || x !== ''; }).join(sep); },
    LEN: function (a) { return str(a[0]).length; }, LEFT: function (a) { return str(a[0]).slice(0, a.length > 1 ? num(a[1]) : 1); },
    RIGHT: function (a) { var s = str(a[0]), n = a.length > 1 ? num(a[1]) : 1; return n ? s.slice(-n) : ''; }, MID: function (a) { return str(a[0]).substr(num(a[1]) - 1, num(a[2])); },
    UPPER: function (a) { return str(a[0]).toUpperCase(); }, LOWER: function (a) { return str(a[0]).toLowerCase(); }, TRIM: function (a) { return str(a[0]).trim().replace(/\s+/g, ' '); },
    SUBSTITUTE: function (a) { return str(a[0]).split(str(a[1])).join(str(a[2])); }, FIND: function (a) { var i = str(a[1]).indexOf(str(a[0])); return i < 0 ? ERR('#VALUE!') : i + 1; },
    TEXT: function (a) { var n = num(a[0]), f = str(a[1]); if (isErr(n)) return str(a[0]); var d = (/\.(0+)/.exec(f) || [0, ''])[1].length; var s = n.toFixed(d); if (/,/.test(f)) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); if (/%$/.test(f)) s = (n * 100).toFixed(d) + '%'; return s; },
    VALUE: function (a) { return num(a[0]); },
    SUMIF: function (a) { var R = a[0], f = crit(a[1]), S = a[2] || a[0], s = 0; rows(R).forEach(function (row, i) { row.forEach(function (v, j) { if (f(v)) { var x = S[i] && S[i][j]; if (typeof x === 'number') s += x; } }); }); return s; },
    COUNTIF: function (a) { var f = crit(a[1]), n = 0; rows(a[0]).forEach(function (row) { row.forEach(function (v) { if (f(v)) n++; }); }); return n; },
    AVERAGEIF: function (a) { var R = a[0], f = crit(a[1]), S = a[2] || a[0], s = 0, n = 0; rows(R).forEach(function (row, i) { row.forEach(function (v, j) { if (f(v)) { var x = S[i] && S[i][j]; if (typeof x === 'number') { s += x; n++; } } }); }); return n ? s / n : ERR('#DIV/0!'); },
    SUMPRODUCT: function (a) { var A = a.map(rows), s = 0; A[0].forEach(function (row, i) { row.forEach(function (v, j) { var p = 1; A.forEach(function (M) { var x = M[i] && M[i][j]; p *= typeof x === 'number' ? x : 0; }); s += p; }); }); return s; },
    VLOOKUP: function (a) { var key = a[0], T = rows(a[1]), c = num(a[2]) - 1, exact = a.length > 3 && !num(a[3]);
      for (var i = 0; i < T.length; i++) if (eqv(T[i][0], key)) return T[i][c] == null ? '' : T[i][c];
      if (!exact) { var best = -1; for (var k = 0; k < T.length; k++) if (typeof T[k][0] === 'number' && T[k][0] <= num(key)) best = k; if (best >= 0) return T[best][c]; }
      return ERR('#N/A'); },
    HLOOKUP: function (a) { var T = rows(a[1]), r = num(a[2]) - 1; for (var j = 0; j < (T[0] || []).length; j++) if (eqv(T[0][j], a[0])) return T[r] ? T[r][j] : ERR('#REF!'); return ERR('#N/A'); },
    INDEX: function (a) { var T = rows(a[0]), r = a.length > 1 ? num(a[1]) : 1, c = a.length > 2 ? num(a[2]) : 1; if (T.length === 1 && a.length === 2) { c = r; r = 1; } var row = T[(r || 1) - 1]; return row && row[(c || 1) - 1] != null ? row[(c || 1) - 1] : ERR('#REF!'); },
    MATCH: function (a) { var L = flat([a[1]]).map(function (x) { return x.v; }); for (var i = 0; i < L.length; i++) if (eqv(L[i], a[0])) return i + 1; return ERR('#N/A'); },
    TODAY: function () { return serial(new Date()); }, NOW: function () { var d = new Date(); return serial(d) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; },
    YEAR: function (a) { return fromSerial(num(a[0])).getFullYear(); }, MONTH: function (a) { return fromSerial(num(a[0])).getMonth() + 1; }, DAY: function (a) { return fromSerial(num(a[0])).getDate(); },
    DATE: function (a) { return serial(new Date(num(a[0]), num(a[1]) - 1, num(a[2]))); },
    PI: function () { return Math.PI; }, RAND: function () { return Math.random(); }
  };
  function eqv(x, y) { if (Array.isArray(y)) y = y[0]; if (typeof x === 'number' || typeof y === 'number') return num(x) === num(y); return str(x).toLowerCase() === str(y).toLowerCase(); }
  function rows(x) { return Array.isArray(x) ? x.map(function (r) { return Array.isArray(r) ? r : [r]; }) : [[x]]; }
  function serial(d) { return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000); }
  function fromSerial(n) { var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  D.serialToDate = function (n) { var d = fromSerial(n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  // 重新计算整个工作簿（公式格的 v）；循环引用给 #CYCLE!
  function recalc(book) {
    var memo = {}, busy = {};
    function sheetOf(name) { if (!name) return null; for (var i = 0; i < book.sheets.length; i++) if (book.sheets[i].name.toLowerCase() === name.toLowerCase()) return book.sheets[i]; return null; }
    function cellVal(sh, ref) {
      var key = sh.name + '!' + ref, c = sh.cells[ref];
      if (!c) return '';
      if (c.f == null) return c.v == null ? '' : c.v;
      if (key in memo) return memo[key];
      if (busy[key]) return ERR('#CYCLE!');
      busy[key] = 1;
      var v;
      try { if (!c._ast) c._ast = parseFormula(c.f); v = ev(c._ast, sh); } catch (e) { v = isErr(e) ? e : ERR('#VALUE!'); }
      if (Array.isArray(v)) v = v[0] && Array.isArray(v[0]) ? v[0][0] : v[0];
      busy[key] = 0; memo[key] = v; return v;
    }
    function ev(n, sh) {
      if (n.k === 'num' || n.k === 'str' || n.k === 'bool') return n.v;
      if (n.k === 'blank') return '';
      if (n.k === 'ref') {
        var s2 = n.sheet ? sheetOf(n.sheet) : sh; if (!s2) return ERR('#REF!');
        if (n.v.indexOf(':') < 0) return cellVal(s2, n.v);
        var R = parseRange(n.v); if (!R) return ERR('#REF!');
        var b = bounds(s2), r2 = Math.min(R.r2, Math.max(b.rows, R.r1)), c2 = Math.min(R.c2, Math.max(b.cols, R.c1)), out = [];
        for (var r = R.r1; r <= r2; r++) { var row = []; for (var cc = R.c1; cc <= c2; cc++) row.push(cellVal(s2, refName(cc, r))); out.push(row); }
        return out;
      }
      if (n.fn) {
        if (n.fn === 'IF') { var cnd = num(ev(n.args[0], sh)); if (isErr(cnd)) return cnd; return cnd ? (n.args[1] ? ev(n.args[1], sh) : true) : (n.args[2] ? ev(n.args[2], sh) : false); }
        if (n.fn === 'IFERROR') { var v0 = ev(n.args[0], sh); if (Array.isArray(v0)) v0 = v0[0] && v0[0][0]; return isErr(v0) ? ev(n.args[1], sh) : v0; }
        var f = FN[n.fn]; if (!f) return ERR('#NAME?');
        var args = n.args.map(function (a) { return ev(a, sh); });
        for (var i = 0; i < args.length; i++) if (isErr(args[i])) return args[i];
        return f(args);
      }
      var a = ev(n.a, sh), b2 = n.b ? ev(n.b, sh) : null;
      if (Array.isArray(a)) a = a[0] && a[0][0]; if (Array.isArray(b2)) b2 = b2[0] && b2[0][0];
      if (isErr(a)) return a; if (isErr(b2)) return b2;
      switch (n.op) {
        case 'neg': return -num(a);
        case '+': return num(a) + num(b2); case '-': return num(a) - num(b2); case '*': return num(a) * num(b2);
        case '/': return num(b2) === 0 ? ERR('#DIV/0!') : num(a) / num(b2);
        case '^': return Math.pow(num(a), num(b2)); case '&': return str(a) + str(b2);
        case '=': return eqv(a, b2); case '<>': return !eqv(a, b2);
        case '<': return typeof a === 'string' || typeof b2 === 'string' ? str(a) < str(b2) : num(a) < num(b2);
        case '>': return typeof a === 'string' || typeof b2 === 'string' ? str(a) > str(b2) : num(a) > num(b2);
        case '<=': return num(a) <= num(b2); case '>=': return num(a) >= num(b2);
      }
      return ERR('#VALUE!');
    }
    book.sheets.forEach(function (sh) {
      Object.keys(sh.cells).forEach(function (k) {
        var c = sh.cells[k]; if (c.f == null) return;
        c._ast = null; var v = cellVal(sh, k);
        c.v = typeof v === 'number' && !isFinite(v) ? '#NUM!' : isErr(v) ? v.err : v;
      });
    });
    return book;
  }
  D.recalc = recalc;
  D.display = function (c) {
    if (!c) return '';
    var v = c.v;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') { if (c.date) return D.serialToDate(v); var s = Number.isInteger(v) ? String(v) : String(+v.toFixed(10)); if (/^-?\d{4,}(\.\d+)?$/.test(s)) s = s.replace(/^(-?\d+)/, function (m) { return m.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }); return s; }
    return v == null ? '' : String(v);
  };

  /* ---------------- xlsx 读写 ---------------- */
  var XP = new DOMParser();
  function xml(u8) { return XP.parseFromString(new TextDecoder().decode(u8), 'application/xml'); }
  function kids(el, tag) { var o = []; if (!el) return o; for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 1 && (n.localName === tag || n.nodeName === tag)) o.push(n); } return o; }
  function all(el, tag) { return el ? Array.prototype.slice.call(el.getElementsByTagNameNS('*', tag)) : []; }
  var DATE_FMT = { 14: 1, 15: 1, 16: 1, 17: 1, 22: 1, 27: 1, 30: 1, 36: 1, 50: 1, 57: 1 };
  function readXlsx(buf) {
    return unzip(buf).then(function (z) {
      var wbPath = 'xl/workbook.xml';
      var rel = z['_rels/.rels'] && all(xml(z['_rels/.rels']), 'Relationship').filter(function (r) { return /officeDocument$/.test(r.getAttribute('Type')); })[0];
      if (rel) wbPath = rel.getAttribute('Target').replace(/^\//, '');
      var base = wbPath.replace(/[^/]*$/, ''), wb = z[wbPath] && xml(z[wbPath]);
      if (!wb) throw { msg: '不是有效的 Excel 文件' };
      var rels = {}, rp = base + '_rels/' + wbPath.replace(/^.*\//, '') + '.rels';
      if (z[rp]) all(xml(z[rp]), 'Relationship').forEach(function (r) { var t = r.getAttribute('Target'); rels[r.getAttribute('Id')] = t.charAt(0) === '/' ? t.slice(1) : base + t; });
      var ss = [];
      var ssPath = Object.keys(rels).map(function (k) { return rels[k]; }).filter(function (p) { return /sharedStrings\.xml$/.test(p); })[0] || base + 'sharedStrings.xml';
      if (z[ssPath]) all(xml(z[ssPath]), 'si').forEach(function (si) { ss.push(all(si, 't').filter(function (t) { return !t.parentNode || t.parentNode.localName !== 'rPh'; }).map(function (t) { return t.textContent; }).join('')); });
      var dateStyle = [];
      var stPath = Object.keys(rels).map(function (k) { return rels[k]; }).filter(function (p) { return /styles\.xml$/.test(p); })[0] || base + 'styles.xml';
      if (z[stPath]) {
        var sd = xml(z[stPath]), custom = {};
        all(sd, 'numFmt').forEach(function (f) { if (/[ymd]/i.test(f.getAttribute('formatCode').replace(/"[^"]*"|\[[^\]]*\]/g, ''))) custom[f.getAttribute('numFmtId')] = 1; });
        var xfs = all(sd, 'cellXfs')[0];
        kids(xfs, 'xf').forEach(function (x, i) { var id = x.getAttribute('numFmtId'); dateStyle[i] = !!(DATE_FMT[id] || custom[id]); });
      }
      var book = { sheets: [] };
      all(wb, 'sheet').forEach(function (s) {
        var rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
        var p = rels[rid], d = p && z[p] && xml(z[p]), sh = { name: s.getAttribute('name'), cells: {}, merges: [], widths: {} };
        if (d) {
          all(d, 'c').forEach(function (c) {
            var r = c.getAttribute('r'), t = c.getAttribute('t'), fEl = kids(c, 'f')[0], vEl = kids(c, 'v')[0], v = vEl ? vEl.textContent : null, cell = {};
            if (t === 's') cell.v = ss[+v] != null ? ss[+v] : '';
            else if (t === 'inlineStr') cell.v = all(c, 't').map(function (x) { return x.textContent; }).join('');
            else if (t === 'str' || t === 'e') cell.v = v || '';
            else if (t === 'b') cell.v = v === '1';
            else if (v != null && v !== '') cell.v = Number(v);
            if (fEl && fEl.textContent) cell.f = fEl.textContent;
            var sIdx = c.getAttribute('s'); if (sIdx && dateStyle[+sIdx] && typeof cell.v === 'number') cell.date = 1;
            if (cell.v == null && cell.f == null) return;
            if (!r) return; sh.cells[r] = cell;
          });
          all(d, 'mergeCell').forEach(function (m) { sh.merges.push(m.getAttribute('ref')); });
          all(d, 'col').forEach(function (cl) { var w = +cl.getAttribute('width'); for (var i = +cl.getAttribute('min'); i <= +cl.getAttribute('max') && i < 200; i++) sh.widths[colName(i)] = w; });
        }
        book.sheets.push(sh);
      });
      if (!book.sheets.length) throw { msg: '表格里没有工作表' };
      return book;
    });
  }
  function escX(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); }
  function writeXlsx(book) {
    recalc(book);
    var sheetsXml = book.sheets.map(function (sh) {
      var byRow = {};
      Object.keys(sh.cells).forEach(function (k) { var p = parseRef(k); if (p) (byRow[p.r] = byRow[p.r] || []).push([p.c, k, sh.cells[k]]); });
      var rowsX = Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; }).map(function (r) {
        return '<row r="' + r + '">' + byRow[r].sort(function (a, b) { return a[0] - b[0]; }).map(function (x) {
          var c = x[2], k = x[1], f = c.f != null ? '<f>' + escX(c.f) + '</f>' : '', v = c.v, st = c.date ? ' s="1"' : c.bold ? ' s="2"' : '';
          if (typeof v === 'number' && isFinite(v)) return '<c r="' + k + '"' + st + '>' + f + '<v>' + v + '</v></c>';
          if (typeof v === 'boolean') return '<c r="' + k + '" t="b"' + st + '>' + f + '<v>' + (v ? 1 : 0) + '</v></c>';
          if (c.f != null) return '<c r="' + k + '" t="str"' + st + '>' + f + '<v>' + escX(v == null ? '' : v) + '</v></c>';
          return '<c r="' + k + '" t="inlineStr"' + st + '><is><t xml:space="preserve">' + escX(v == null ? '' : v) + '</t></is></c>';
        }).join('') + '</row>';
      }).join('');
      var cols = Object.keys(sh.widths || {}).length ? '<cols>' + Object.keys(sh.widths).map(function (c) { var n = colNum(c); return '<col min="' + n + '" max="' + n + '" width="' + sh.widths[c] + '" customWidth="1"/>'; }).join('') + '</cols>' : '';
      var merges = (sh.merges || []).length ? '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' : '';
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + cols + '<sheetData>' + rowsX + '</sheetData>' + merges + '</worksheet>';
    });
    var E = [
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        book.sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        book.sheets.map(function (s, i) { return '<sheet name="' + escX(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets><calcPr fullCalcOnLoad="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        book.sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (book.sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>' }
    ];
    sheetsXml.forEach(function (x, i) { E.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: x }); });
    return zip(E, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  D.readXlsx = readXlsx; D.writeXlsx = writeXlsx;

  /* ---------------- CSV ---------------- */
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var sep = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    var rowsA = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
      if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rowsA.push(row); row = []; cur = ''; } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rowsA.push(row); }
    return fromRows('表1', rowsA);
  }
  function autoVal(s) {
    if (s == null) return null;
    if (typeof s !== 'string') return { v: s };
    if (s === '') return null;
    if (s.charAt(0) === '=') return { f: s.slice(1) };
    var t = s.trim();
    if (/^-?[\d,]*\.?\d+(e[+-]?\d+)?$/i.test(t) && !/^0\d/.test(t)) return { v: Number(t.replace(/,/g, '')) };
    if (/^-?\d+(\.\d+)?%$/.test(t)) return { v: Number(t.slice(0, -1)) / 100 };
    if (/^(true|false)$/i.test(t)) return { v: /^t/i.test(t) };
    return { v: s };
  }
  function fromRows(name, rowsA) {
    var sh = { name: name, cells: {}, merges: [], widths: {} };
    rowsA.forEach(function (r, i) { r.forEach(function (v, j) { var c = autoVal(v); if (c) sh.cells[refName(j + 1, i + 1)] = c; }); });
    return recalc({ sheets: [sh] });
  }
  function writeCsv(book, si) {
    recalc(book);
    var sh = book.sheets[si || 0], b = bounds(sh), out = [];
    for (var r = 1; r <= b.rows; r++) { var row = []; for (var c = 1; c <= b.cols; c++) { var s = D.display(sh.cells[refName(c, r)]); row.push(/[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s); } out.push(row.join(',')); }
    return new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  }
  D.parseCsv = parseCsv; D.writeCsv = writeCsv; D.fromRows = fromRows; D.autoVal = autoVal;

  // 读成文字（给模型看）：TSV 带行列号；公式格写成「值 ⟨=公式⟩」
  D.sheetText = function (book, opt) {
    opt = opt || {}; var out = [], limit = opt.max || 30000;
    book.sheets.forEach(function (sh) {
      if (opt.sheet && sh.name !== opt.sheet) return;
      var b = bounds(sh), R = opt.range ? parseRange(opt.range) : { r1: 1, c1: 1, r2: b.rows, c2: b.cols };
      if (!R) return;
      out.push('## 工作表「' + sh.name + '」 ' + b.rows + ' 行 × ' + b.cols + ' 列' + (sh.merges.length ? ' · 合并单元格 ' + sh.merges.join(' ') : ''));
      var head = ['行'].concat(Array.from({ length: Math.min(R.c2, b.cols) - R.c1 + 1 }, function (_, i) { return colName(R.c1 + i); }));
      out.push(head.join('\t'));
      for (var r = R.r1; r <= Math.min(R.r2, b.rows); r++) {
        var row = [r];
        for (var c = R.c1; c <= Math.min(R.c2, b.cols); c++) { var cell = sh.cells[refName(c, r)]; row.push(cell ? D.display(cell) + (cell.f != null ? ' ⟨=' + cell.f + '⟩' : '') : ''); }
        out.push(row.join('\t'));
      }
    });
    var s = out.join('\n');
    return s.length > limit ? s.slice(0, limit) + '\n…（后面还有，用 range 分段读）' : s;
  };

  // 改表格：ops 按顺序执行，返回改动清单 diff [['+'|'-', 文字]]
  function shiftFormula(f, sheet, at, n, isCol, curSheet) {
    // 一个引用（可带表名、可是 A1:B2 区域）整体处理：区域两头用同一个表名
    return f.replace(/((?:'[^']+'|[A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*)!)?(\$?[A-Z]{1,3}\$?\d+)(:\$?[A-Z]{1,3}\$?\d+)?/g, function (m, sp, r1, r2) {
      var sn = sp ? sp.slice(0, -1).replace(/^'|'$/g, '') : curSheet; if (sn !== sheet) return m;
      function one(ref) {
        var q = /^(\$?)([A-Z]{1,3})(\$?)(\d+)$/.exec(ref); if (!q) return ref;
        if (isCol) { var c = colNum(q[2]); if (c >= at) { c += n; if (c < 1) return '#REF!'; } return q[1] + colName(c) + q[3] + q[4]; }
        var r = +q[4]; if (r >= at) { r += n; if (r < 1) return '#REF!'; } return q[1] + q[2] + q[3] + r;
      }
      return (sp || '') + one(r1) + (r2 ? ':' + one(r2.slice(1)) : '');
    });
  }
  D.edit = function (book, ops) {
    var diff = [], S = function (name) { if (!name) return book.sheets[0]; for (var i = 0; i < book.sheets.length; i++) if (book.sheets[i].name === name) return book.sheets[i]; return null; };
    var before = JSON.parse(JSON.stringify(book, function (k, v) { return k === '_ast' ? undefined : v; })), moved = {}, touched = {};
    (ops || []).forEach(function (op) {
      var sh = S(op.sheet);
      if (op.op === 'add_sheet') { if (!S(op.name)) { book.sheets.push({ name: op.name, cells: {}, merges: [], widths: {} }); diff.push(['+', '新工作表「' + op.name + '」']); } if (op.rows) { var nb = fromRows(op.name, op.rows).sheets[0]; S(op.name).cells = nb.cells; } return; }
      if (!sh) throw { msg: '没有叫「' + op.sheet + '」的工作表' };
      if (op.op === 'rename_sheet') { diff.push(['-', '工作表「' + sh.name + '」']); diff.push(['+', '工作表「' + op.name + '」']); book.sheets.forEach(function (s) { Object.keys(s.cells).forEach(function (k) { var c = s.cells[k]; if (c.f) c.f = c.f.split(sh.name + '!').join(op.name + '!').split("'" + sh.name + "'!").join("'" + op.name + "'!"); }); }); sh.name = op.name; return; }
      if (op.op === 'delete_sheet') { book.sheets = book.sheets.filter(function (s) { return s !== sh; }); diff.push(['-', '工作表「' + sh.name + '」']); return; }
      if (op.op === 'set') {
        Object.keys(op.cells || {}).forEach(function (k) {
          var ref = k.toUpperCase().replace(/\$/g, ''); if (!parseRef(ref)) throw { msg: '格子地址不对：' + k };
          var nv = op.cells[k], c = nv === null || nv === '' ? null : autoVal(typeof nv === 'number' || typeof nv === 'boolean' ? nv : String(nv));
          if (c && typeof nv !== 'string' && typeof nv !== 'number' && typeof nv !== 'boolean') c = { v: nv };
          if (c) sh.cells[ref] = Object.assign(sh.cells[ref] && sh.cells[ref].bold ? { bold: 1 } : {}, c); else delete sh.cells[ref];
          touched[sh.name + '!' + ref] = 1;
        });
        return;
      }
      if (op.op === 'bold') { var BR = parseRange(op.range); if (!BR) return; for (var br = BR.r1; br <= BR.r2; br++) for (var bc = BR.c1; bc <= BR.c2; bc++) { var bk = refName(bc, br); if (sh.cells[bk]) sh.cells[bk].bold = 1; } return; }
      if (op.op === 'clear') { var R = parseRange(op.range); if (!R) return; Object.keys(sh.cells).forEach(function (k) { var p = parseRef(k); if (p && p.r >= R.r1 && p.r <= R.r2 && p.c >= R.c1 && p.c <= R.c2) delete sh.cells[k]; }); return; }
      if (op.op === 'insert_rows' || op.op === 'delete_rows' || op.op === 'insert_cols' || op.op === 'delete_cols') {
        var isCol = /cols$/.test(op.op), del = /^delete/.test(op.op), at = isCol ? colNum(String(op.at).toUpperCase()) || +op.at : +op.at, n = Math.max(1, +op.count || 1);
        var moved2 = {}; moved[sh.name] = 1;
        Object.keys(sh.cells).forEach(function (k) {
          var p = parseRef(k), v = isCol ? p.c : p.r;
          if (del && v >= at && v < at + n) return;
          var nv2 = v >= at ? (del ? v - n : v + n) : v;
          moved2[isCol ? refName(nv2, p.r) : refName(p.c, nv2)] = sh.cells[k];
        });
        sh.cells = moved2;
        book.sheets.forEach(function (s) { Object.keys(s.cells).forEach(function (k) { var c = s.cells[k]; if (c.f) c.f = shiftFormula(c.f, sh.name, del ? at + n : at, del ? -n : n, isCol, s.name); }); });
        diff.push([del ? '-' : '+', (del ? '删除' : '插入') + ' ' + n + (isCol ? ' 列（从 ' + colName(at) + ' 列起）' : ' 行（从第 ' + at + ' 行起）')]);
        return;
      }
      if (op.op === 'sort') {
        var SR = parseRange(op.range); if (!SR) return; var kc = colNum(String(op.by || '').toUpperCase()) || SR.c1, desc = !!op.desc, rowsS = [];
        for (var r = SR.r1; r <= SR.r2; r++) { var row = {}; for (var c = SR.c1; c <= SR.c2; c++) row[c] = sh.cells[refName(c, r)]; rowsS.push(row); }
        rowsS.sort(function (a, b) { var x = a[kc] ? a[kc].v : '', y = b[kc] ? b[kc].v : ''; var d2 = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh'); return desc ? -d2 : d2; });
        moved[sh.name] = 1;
        rowsS.forEach(function (row, i) { for (var c = SR.c1; c <= SR.c2; c++) { var k2 = refName(c, SR.r1 + i); if (row[c]) sh.cells[k2] = row[c]; else delete sh.cells[k2]; } });
        diff.push(['+', '按 ' + colName(kc) + ' 列' + (desc ? '从大到小' : '从小到大') + '排序 ' + op.range]);
        return;
      }
      if (op.op === 'merge') { sh.merges.push(String(op.range).toUpperCase()); diff.push(['+', '合并 ' + op.range]); return; }
      if (op.op === 'width') { sh.widths[String(op.col).toUpperCase()] = +op.width; return; }
      throw { msg: '不认识的表格操作：' + op.op };
    });
    recalc(book);
    // 逐格对比
    var bs = {}; before.sheets.forEach(function (s) { bs[s.name] = s; });
    book.sheets.forEach(function (s) {
      var o = bs[s.name]; if (!o) return;
      var keys = {}; Object.keys(s.cells).concat(Object.keys(o.cells)).forEach(function (k) { keys[k] = 1; });
      // 插行 / 删行 / 排序过的表：地址都挪了，只列这次明确改过的格子（结构变化已经单独写了一行）
      if (moved[s.name]) keys = {}, Object.keys(touched).forEach(function (t) { var i = t.indexOf('!'); if (t.slice(0, i) === s.name) keys[t.slice(i + 1)] = 1; });
      Object.keys(keys).sort(function (a, b) { var p = parseRef(a), q = parseRef(b); return p.r - q.r || p.c - q.c; }).forEach(function (k) {
        var a = o.cells[k], b = s.cells[k], fa = a && a.f != null ? '=' + a.f : null, fb = b && b.f != null ? '=' + b.f : null;
        var da = a ? D.display(a) : '', db = b ? D.display(b) : '';
        if (fa === fb && da === db) return;
        var pre = book.sheets.length > 1 ? s.name + '!' : '';
        if (a && (da !== '' || fa) && !moved[s.name]) diff.push(['-', pre + k + ' ' + (fa || da)]);
        if (b && (db !== '' || fb)) diff.push(['+', pre + k + ' ' + (fb ? fb + '  → ' + db : db)]);
      });
    });
    return diff;
  };
  // 两个版本逐格比较：{ 'Sheet!A1': 'new' | 'chg' }
  D.changes = function (oldB, newB) {
    var m = {}, bs = {}; (oldB ? oldB.sheets : []).forEach(function (s) { bs[s.name] = s; });
    newB.sheets.forEach(function (s) {
      var o = bs[s.name];
      Object.keys(s.cells).forEach(function (k) { var a = o && o.cells[k], b = s.cells[k]; if (!a || (a.v == null && a.f == null)) m[s.name + '!' + k] = 'new'; else if (D.display(a) !== D.display(b) || (a.f || '') !== (b.f || '')) m[s.name + '!' + k] = 'chg'; });
    });
    return m;
  };
  D.clone = function (b) { return JSON.parse(JSON.stringify(b, function (k, v) { return k === '_ast' ? undefined : v; })); };

  /* ---------------- Word（只读文字） ---------------- */
  D.readDocx = function (buf) {
    return unzip(buf).then(function (z) {
      var d = z['word/document.xml']; if (!d) throw { msg: '不是有效的 Word 文件' };
      var doc = xml(d), body = all(doc, 'body')[0], out = [];
      function para(p) { return all(p, 't').map(function (t) { return t.textContent; }).join('') + (all(p, 'tab').length ? '' : ''); }
      kids(body, 'p').concat(kids(body, 'tbl')).length;
      for (var i = 0; body && i < body.childNodes.length; i++) {
        var n = body.childNodes[i]; if (n.nodeType !== 1) continue;
        if (n.localName === 'p') { var st = all(n, 'pStyle')[0], s = para(n); if (st && /heading|标题|Title/i.test(st.getAttribute('w:val') || '')) s = '## ' + s; out.push(s); }
        else if (n.localName === 'tbl') all(n, 'tr').forEach(function (tr) { out.push('| ' + all(tr, 'tc').map(function (tc) { return all(tc, 'p').map(para).join(' '); }).join(' | ') + ' |'); });
      }
      return out.join('\n').replace(/\n{3,}/g, '\n\n');
    });
  };

  window.Docs = D;
})();
