"""Minimal DEX (version 035) writer for one Activity class that hosts a WebView."""
import struct, zlib, hashlib


def uleb(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def mutf8(s):
    out = bytearray()
    for ch in s:
        c = ord(ch)
        if c == 0:
            out += b'\xc0\x80'
        elif c < 0x80:
            out.append(c)
        elif c < 0x800:
            out += bytes([0xC0 | (c >> 6), 0x80 | (c & 0x3F)])
        elif c < 0x10000:
            out += bytes([0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)])
        else:
            raise ValueError('non-BMP not supported')
    return bytes(out)


def shorty_of(desc):
    return 'L' if desc[0] in 'L[' else desc


class Dex:
    def __init__(self):
        self.strings = set()
        self.types = set()
        self.protos = set()   # (ret, (params...))
        self.methods = set()  # (cls, name, (ret, params))
        self.classes = []

    def s(self, x):
        self.strings.add(x)

    def t(self, d):
        self.types.add(d)
        self.s(d)

    def p(self, ret, params):
        self.t(ret)
        for q in params:
            self.t(q)
        self.s(shorty_of(ret) + ''.join(shorty_of(q) for q in params))
        self.protos.add((ret, tuple(params)))

    def m(self, cls, name, ret, params):
        self.t(cls)
        self.s(name)
        self.p(ret, params)
        key = (cls, name, (ret, tuple(params)))
        self.methods.add(key)
        return key

    def add_class(self, name, superclass, direct, virtual, access=0x1):
        """direct/virtual: list of (method_key, access_flags, regs, ins, outs, insns_builder)"""
        self.t(name)
        self.t(superclass)
        self.classes.append((name, superclass, access, direct, virtual))

    # ------------------------------------------------------------------
    def build(self):
        strings = sorted(self.strings, key=lambda x: [ord(c) for c in x])
        sidx = {x: i for i, x in enumerate(strings)}
        types = sorted(self.types, key=lambda d: sidx[d])
        tidx = {d: i for i, d in enumerate(types)}

        def proto_key(pr):
            return (tidx[pr[0]], [tidx[q] for q in pr[1]])
        protos = sorted(self.protos, key=proto_key)
        pidx = {pr: i for i, pr in enumerate(protos)}
        methods = sorted(self.methods, key=lambda k: (tidx[k[0]], sidx[k[1]], pidx[(k[2][0], k[2][1])]))
        midx = {k: i for i, k in enumerate(methods)}

        # layout
        HDR = 0x70
        off = HDR
        string_ids_off = off; off += 4 * len(strings)
        type_ids_off = off; off += 4 * len(types)
        proto_ids_off = off; off += 12 * len(protos)
        method_ids_off = off; off += 8 * len(methods)
        class_defs_off = off; off += 32 * len(self.classes)
        data_off = off

        data = bytearray()

        def cur():
            return data_off + len(data)

        def align4():
            while cur() % 4:
                data.append(0)

        # code items
        align4()
        code_items_off = cur()
        code_offsets = {}
        n_code = 0
        for (name, sup, acc, direct, virtual) in self.classes:
            for (mk, flags, regs, ins, outs, build_insns) in direct + virtual:
                align4()
                code_offsets[mk] = cur()
                insns = build_insns(lambda k: midx[k], lambda d: tidx[d], lambda x: sidx[x])
                data.extend(struct.pack('<HHHHII', regs, ins, outs, 0, 0, len(insns)))
                for u in insns:
                    data.extend(struct.pack('<H', u))
                n_code += 1

        # type lists (proto params)
        align4()
        type_lists_off = cur()
        tl_offsets = {}
        n_tl = 0
        for pr in protos:
            params = pr[1]
            if not params or params in tl_offsets:
                continue
            align4()
            tl_offsets[params] = cur()
            data.extend(struct.pack('<I', len(params)))
            for q in params:
                data.extend(struct.pack('<H', tidx[q]))
            n_tl += 1

        # string data
        string_data_off = cur()
        sd_offsets = []
        for x in strings:
            sd_offsets.append(cur())
            data.extend(uleb(len(x)) + mutf8(x) + b'\x00')

        # class data
        class_data_off = cur()
        cd_offsets = []
        for (name, sup, acc, direct, virtual) in self.classes:
            cd_offsets.append(cur())
            data.extend(uleb(0) + uleb(0) + uleb(len(direct)) + uleb(len(virtual)))
            for group in (direct, virtual):
                prev = 0
                for (mk, flags, *_rest) in sorted(group, key=lambda e: midx[e[0]]):
                    i = midx[mk]
                    data.extend(uleb(i - prev) + uleb(flags) + uleb(code_offsets[mk]))
                    prev = i

        # map list
        align4()
        map_off = cur()
        items = [
            (0x0000, 1, 0),
            (0x0001, len(strings), string_ids_off),
            (0x0002, len(types), type_ids_off),
            (0x0003, len(protos), proto_ids_off),
            (0x0005, len(methods), method_ids_off),
            (0x0006, len(self.classes), class_defs_off),
            (0x2001, n_code, code_items_off),
        ]
        if n_tl:
            items.append((0x1001, n_tl, type_lists_off))
        items += [
            (0x2002, len(strings), string_data_off),
            (0x2000, len(self.classes), class_data_off),
            (0x1000, 1, map_off),
        ]
        items.sort(key=lambda it: it[2])
        data.extend(struct.pack('<I', len(items)))
        for (ty, size, o) in items:
            data.extend(struct.pack('<HHII', ty, 0, size, o))
        align4()

        # id sections
        ids = bytearray()
        for o in sd_offsets:
            ids += struct.pack('<I', o)
        for d in types:
            ids += struct.pack('<I', sidx[d])
        for pr in protos:
            shorty = shorty_of(pr[0]) + ''.join(shorty_of(q) for q in pr[1])
            ids += struct.pack('<III', sidx[shorty], tidx[pr[0]], tl_offsets.get(pr[1], 0) if pr[1] else 0)
        for k in methods:
            ids += struct.pack('<HHI', tidx[k[0]], pidx[(k[2][0], k[2][1])], sidx[k[1]])
        for ci, (name, sup, acc, direct, virtual) in enumerate(self.classes):
            ids += struct.pack('<IIIIIIII', tidx[name], acc, tidx[sup], 0, 0xFFFFFFFF, 0, cd_offsets[ci], 0)
        assert HDR + len(ids) == data_off

        file_size = data_off + len(data)
        header = bytearray(struct.pack('<8sI20sIIIIIIIIIIIIIIIIIIII',
            b'dex\n035\x00', 0, b'\x00' * 20, file_size, HDR, 0x12345678, 0, 0, map_off,
            len(strings), string_ids_off, len(types), type_ids_off, len(protos), proto_ids_off,
            0, 0, len(methods), method_ids_off, len(self.classes), class_defs_off,
            len(data), data_off))
        assert len(header) == HDR, len(header)
        blob = bytearray(header + ids + data)
        blob[12:32] = hashlib.sha1(bytes(blob[32:])).digest()
        blob[8:12] = struct.pack('<I', zlib.adler32(bytes(blob[12:])) & 0xFFFFFFFF)
        return bytes(blob)


# ---------------------------------------------------------------- instructions
def i35c(op, method, regs):
    """invoke-* with up to 5 registers."""
    a = len(regs)
    r = list(regs) + [0] * (5 - a)
    c, d, e, f, g = r
    return [op | (((a << 4) | g) << 8), method, (f << 12) | (e << 8) | (d << 4) | c]


def i21c(op, reg, idx):
    return [op | (reg << 8), idx]


def i11x(op, reg):
    return [op | (reg << 8)]


def i11n(op, reg, lit):
    return [op | (((lit & 0xF) << 4 | reg) << 8)]


INVOKE_VIRTUAL, INVOKE_SUPER, INVOKE_DIRECT = 0x6E, 0x6F, 0x70
NEW_INSTANCE, CONST_STRING, CONST4, CONST16 = 0x22, 0x1A, 0x12, 0x13
MOVE_RESULT_OBJECT, RETURN_VOID = 0x0C, 0x0E
MOVE_RESULT, CHECK_CAST, IF_EQZ = 0x0A, 0x1F, 0x38
WV_ID = 0x0100
CONST32 = 0x14
BG_ARGB = 0xFF141A2D


def build_webview_dex(activity_desc, url):
    d = Dex()
    ACT = 'Landroid/app/Activity;'
    WV = 'Landroid/webkit/WebView;'
    WS = 'Landroid/webkit/WebSettings;'
    WVC = 'Landroid/webkit/WebViewClient;'
    CTX = 'Landroid/content/Context;'
    BUNDLE = 'Landroid/os/Bundle;'
    VIEW = 'Landroid/view/View;'
    STR = 'Ljava/lang/String;'

    act_init = d.m(ACT, '<init>', 'V', [])
    act_oncreate = d.m(ACT, 'onCreate', 'V', [BUNDLE])
    act_reqfeat = d.m(ACT, 'requestWindowFeature', 'Z', ['I'])
    act_setcv = d.m(ACT, 'setContentView', 'V', [VIEW])
    wv_init = d.m(WV, '<init>', 'V', [CTX])
    wv_gs = d.m(WV, 'getSettings', WS, [])
    wv_swc = d.m(WV, 'setWebViewClient', 'V', [WVC])
    wv_load = d.m(WV, 'loadUrl', 'V', [STR])
    ws_js = d.m(WS, 'setJavaScriptEnabled', 'V', ['Z'])
    ws_dom = d.m(WS, 'setDomStorageEnabled', 'V', ['Z'])
    ws_file = d.m(WS, 'setAllowFileAccess', 'V', ['Z'])
    ws_univ = d.m(WS, 'setAllowUniversalAccessFromFileURLs', 'V', ['Z'])
    ws_zoom = d.m(WS, 'setTextZoom', 'V', ['I'])
    ws_media = d.m(WS, 'setMediaPlaybackRequiresUserGesture', 'V', ['Z'])
    wvc_init = d.m(WVC, '<init>', 'V', [])
    my_init = d.m(activity_desc, '<init>', 'V', [])
    my_oncreate = d.m(activity_desc, 'onCreate', 'V', [BUNDLE])
    # 返回键 / 侧滑返回：网页里还有上一级就退回上一级，没有才交给系统
    act_finish = d.m(ACT, 'finish', 'V', [])
    my_onback = d.m(activity_desc, 'onBackPressed', 'V', [])
    act_find = d.m(ACT, 'findViewById', VIEW, ['I'])
    view_setid = d.m(VIEW, 'setId', 'V', ['I'])
    wv_setbg = d.m(WV, 'setBackgroundColor', 'V', ['I'])
    wv_canback = d.m(WV, 'canGoBack', 'Z', [])
    wv_goback = d.m(WV, 'goBack', 'V', [])
    d.s(url)

    def init_code(M, T, S):
        return i35c(INVOKE_DIRECT, M(act_init), [0]) + [RETURN_VOID]

    # registers: v0..v3 locals, v4 = this, v5 = savedInstanceState
    def oncreate_code(M, T, S):
        c = []
        c += i35c(INVOKE_SUPER, M(act_oncreate), [4, 5])
        c += i11n(CONST4, 0, 1)                       # FEATURE_NO_TITLE
        c += i35c(INVOKE_VIRTUAL, M(act_reqfeat), [4, 0])
        c += i21c(NEW_INSTANCE, 0, T(WV))
        c += i35c(INVOKE_DIRECT, M(wv_init), [0, 4])
        c += [CONST16 | (2 << 8), WV_ID]
        c += i35c(INVOKE_VIRTUAL, M(view_setid), [0, 2])
        c += [CONST32 | (2 << 8), BG_ARGB & 0xFFFF, BG_ARGB >> 16]   # 启动瞬间就是开屏的深蓝，不闪白
        c += i35c(INVOKE_VIRTUAL, M(wv_setbg), [0, 2])
        c += i35c(INVOKE_VIRTUAL, M(wv_gs), [0])
        c += i11x(MOVE_RESULT_OBJECT, 1)
        c += i11n(CONST4, 2, 1)
        c += i35c(INVOKE_VIRTUAL, M(ws_js), [1, 2])
        c += i35c(INVOKE_VIRTUAL, M(ws_dom), [1, 2])
        c += i35c(INVOKE_VIRTUAL, M(ws_file), [1, 2])
        c += i35c(INVOKE_VIRTUAL, M(ws_univ), [1, 2])
        c += i11n(CONST4, 2, 0)                       # Amor 的回复可以自动朗读，不必每次先点一下
        c += i35c(INVOKE_VIRTUAL, M(ws_media), [1, 2])
        c += [CONST16 | (2 << 8), 100]                # 系统字体放大时页面不跟着放大
        c += i35c(INVOKE_VIRTUAL, M(ws_zoom), [1, 2])
        c += i21c(NEW_INSTANCE, 3, T(WVC))
        c += i35c(INVOKE_DIRECT, M(wvc_init), [3])
        c += i35c(INVOKE_VIRTUAL, M(wv_swc), [0, 3])
        c += i21c(CONST_STRING, 3, S(url))
        c += i35c(INVOKE_VIRTUAL, M(wv_load), [0, 3])
        c += i35c(INVOKE_VIRTUAL, M(act_setcv), [4, 0])
        c += [RETURN_VOID]
        return c

    # registers: v0 webview, v1 flag, v2 = this
    def onback_code(M, T, S):
        c = []
        c += [CONST16 | (0 << 8), WV_ID]                      # 0
        c += i35c(INVOKE_VIRTUAL, M(act_find), [2, 0])        # 2
        c += i11x(MOVE_RESULT_OBJECT, 0)                      # 5
        c += i21c(CHECK_CAST, 0, T(WV))                       # 6
        c += [IF_EQZ | (0 << 8), 12]                          # 8  -> 20
        c += i35c(INVOKE_VIRTUAL, M(wv_canback), [0])         # 10
        c += i11x(MOVE_RESULT, 1)                             # 13
        c += [IF_EQZ | (1 << 8), 6]                           # 14 -> 20
        c += i35c(INVOKE_VIRTUAL, M(wv_goback), [0])          # 16
        c += [RETURN_VOID]                                    # 19
        assert len(c) == 20
        c += i35c(INVOKE_VIRTUAL, M(act_finish), [2])         # 20  真正关闭，下次打开是全新启动（会播开屏）
        c += [RETURN_VOID]
        return c

    d.add_class(activity_desc, ACT,
                direct=[(my_init, 0x10001, 1, 1, 1, init_code)],
                virtual=[(my_oncreate, 0x4, 6, 2, 2, oncreate_code),
                         (my_onback, 0x1, 3, 1, 2, onback_code)])
    return d.build()
