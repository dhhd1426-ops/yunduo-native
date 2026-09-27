"""Independent checks of the APK: zip layout, v2 signature, DEX, manifest, resources."""
import sys, struct, zlib, hashlib, zipfile, subprocess, tempfile, os

apk = open(sys.argv[1], 'rb').read()
ok = True


def check(cond, msg):
    global ok
    print(('  OK   ' if cond else '  FAIL ') + msg)
    ok = ok and cond


# ---------------- zip + alignment
print('ZIP')
z = zipfile.ZipFile(sys.argv[1])
check(z.testzip() is None, 'all CRCs valid')
for info in z.infolist():
    if info.compress_type == zipfile.ZIP_STORED:
        lh = apk[info.header_offset:info.header_offset + 30]
        n, e = struct.unpack('<HH', lh[26:30])
        data_off = info.header_offset + 30 + n + e
        check(data_off % 4 == 0, f'{info.filename} stored and 4-byte aligned (offset {data_off})')

# ---------------- v2 signature
print('APK SIGNATURE SCHEME v2')
eocd = apk.rindex(b'PK\x05\x06')
cd_size, cd_off = struct.unpack('<II', apk[eocd + 12:eocd + 20])
check(apk[cd_off - 16:cd_off] == b'APK Sig Block 42', 'signing block magic before central directory')
size2 = struct.unpack('<Q', apk[cd_off - 24:cd_off - 16])[0]
blk_start = cd_off - size2 - 8
size1 = struct.unpack('<Q', apk[blk_start:blk_start + 8])[0]
check(size1 == size2, 'block size fields match')
pos, pairs = blk_start + 8, {}
while pos < cd_off - 24:
    ln = struct.unpack('<Q', apk[pos:pos + 8])[0]
    pid = struct.unpack('<I', apk[pos + 8:pos + 12])[0]
    pairs[pid] = apk[pos + 12:pos + 8 + ln]
    pos += 8 + ln
check(pos == cd_off - 24, 'pairs fill the block exactly')
check(0x7109871A in pairs, 'v2 block present')


def rd(b, o):
    n = struct.unpack('<I', b[o:o + 4])[0]
    return b[o + 4:o + 4 + n], o + 4 + n


signers, _ = rd(pairs[0x7109871A], 0)
signer, _ = rd(signers, 0)
signed_data, o = rd(signer, 0)
sigs, o = rd(signer, o)
pub, o = rd(signer, o)
digs, so = rd(signed_data, 0)
certs, so = rd(signed_data, so)
d0, _ = rd(digs, 0)
alg, dig = struct.unpack('<I', d0[:4])[0], rd(d0, 4)[0]
s0, _ = rd(sigs, 0)
salg, sig = struct.unpack('<I', s0[:4])[0], rd(s0, 4)[0]
cert, _ = rd(certs, 0)
check(alg == 0x0103 and salg == 0x0103, 'algorithm RSA PKCS#1 v1.5 SHA-256')

# recompute content digest
e = bytearray(apk[eocd:])
struct.pack_into('<I', e, 16, blk_start)
secs = [apk[:blk_start], apk[cd_off:eocd], bytes(e)]
chunks = []
for sct in secs:
    for i in range(0, len(sct), 1 << 20):
        c = sct[i:i + (1 << 20)]
        chunks.append(hashlib.sha256(b'\xa5' + struct.pack('<I', len(c)) + c).digest())
top = hashlib.sha256(b'\x5a' + struct.pack('<I', len(chunks)) + b''.join(chunks)).digest()
check(top == dig, 'content digest matches')

with tempfile.TemporaryDirectory() as td:
    open(td + '/pub.der', 'wb').write(pub)
    open(td + '/sd', 'wb').write(signed_data)
    open(td + '/sig', 'wb').write(sig)
    open(td + '/cert.der', 'wb').write(cert)
    r = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', td + '/pub.der', '-keyform', 'DER',
                        '-signature', td + '/sig', td + '/sd'], capture_output=True, text=True)
    check('Verified OK' in r.stdout, 'RSA signature over signed data verifies')
    cpub = subprocess.run(['openssl', 'x509', '-inform', 'DER', '-in', td + '/cert.der', '-noout', '-pubkey'],
                          capture_output=True, text=True).stdout
    kpub = subprocess.run(['openssl', 'pkey', '-pubin', '-inform', 'DER', '-in', td + '/pub.der'],
                          capture_output=True, text=True).stdout
    check(cpub.strip() == kpub.strip() and cpub.strip() != '', 'certificate key equals signer public key')

# ---------------- DEX
print('DEX')
dex = z.read('classes.dex')
check(dex[:4] == b'dex\n' and dex[4:7] in (b'035', b'037', b'038', b'039') and dex[7] == 0, 'magic dex ' + dex[4:7].decode())
check(struct.unpack('<I', dex[8:12])[0] == zlib.adler32(dex[12:]) & 0xFFFFFFFF, 'adler32 checksum')
check(dex[12:32] == hashlib.sha1(dex[32:]).digest(), 'sha1 signature')
H = struct.unpack('<20I', dex[32:112])
file_size, hsz, endian, _, _, map_off, ss, so_, ts, to, ps, po, fs, fo, ms, mo, cs, co, dsz, do = H
check(file_size == len(dex) and hsz == 0x70 and endian == 0x12345678, 'size/header/endian')
check(do + dsz == len(dex), 'data section reaches end of file')


def uleb(b, o):
    r = s = 0
    while True:
        x = b[o]; o += 1
        r |= (x & 0x7F) << s; s += 7
        if not x & 0x80:
            return r, o


strs = []
for i in range(ss):
    off = struct.unpack('<I', dex[so_ + 4 * i:so_ + 4 * i + 4])[0]
    n, p = uleb(dex, off)
    end = dex.index(b'\x00', p)
    strs.append(dex[p:end].decode('utf-8'))
    assert len(strs[-1]) == n
check(strs == sorted(strs), f'{ss} strings sorted')
types = [strs[struct.unpack('<I', dex[to + 4 * i:to + 4 * i + 4])[0]] for i in range(ts)]
tix = [struct.unpack('<I', dex[to + 4 * i:to + 4 * i + 4])[0] for i in range(ts)]
check(tix == sorted(tix), f'{ts} types sorted')


def tlist(off):
    if not off:
        return []
    n = struct.unpack('<I', dex[off:off + 4])[0]
    return [types[struct.unpack('<H', dex[off + 4 + 2 * k:off + 6 + 2 * k])[0]] for k in range(n)]


protos, pkeys = [], []
for i in range(ps):
    sh, rt, pa = struct.unpack('<III', dex[po + 12 * i:po + 12 * i + 12])
    params = tlist(pa)
    protos.append((strs[sh], types[rt], params))
    pkeys.append((rt, [types.index(x) for x in params]))
    exp_sh = ''.join('L' if t[0] in 'L[' else t for t in [types[rt]] + params)
    check(strs[sh] == exp_sh, f'proto shorty {strs[sh]} matches ({types[rt]} <- {params})')
check(pkeys == sorted(pkeys), 'protos sorted')
meths, mkeys = [], []
for i in range(ms):
    c, pr, nm = struct.unpack('<HHI', dex[mo + 8 * i:mo + 8 * i + 8])
    meths.append(f'{types[c]}->{strs[nm]}({"".join(protos[pr][2])}){protos[pr][1]}')
    mkeys.append((c, nm, pr))
check(mkeys == sorted(mkeys), f'{ms} methods sorted')

# class + code
cs_count = H[16]
if cs_count > 1:
    # 3.8 起 dex 由官方 d8 编译（多个类、完整指令集）：只查结构，逐条指令的检查只用于旧版手写单类 dex
    for ci in range(cs_count):
        cls_, acc_, sup_ = struct.unpack('<3I', dex[co + 32 * ci:co + 32 * ci + 12])
        print('    class', types[cls_], 'extends', types[sup_])
    check(any(t == 'Lcom/cloudweather/xiaoyu/MainActivity;' for t in types), 'MainActivity present')
    check(any(t == 'Lcom/cloudweather/xiaoyu/AmorReceiver;' for t in types), 'AmorReceiver present')
else:
    cls, acc, sup, itf, src, ann, cdo, sv = struct.unpack('<8I', dex[co:co + 32])
    print('    class', types[cls], 'extends', types[sup], 'access', hex(acc))
    sf, p = uleb(dex, cdo)
    inf, p = uleb(dex, p)
    dm, p = uleb(dex, p)
    vm, p = uleb(dex, p)
    OPS = {0x0E: 'return-void', 0x0C: 'move-result-object', 0x12: 'const/4', 0x13: 'const/16', 0x1A: 'const-string', 0x22: 'new-instance',
           0x6E: 'invoke-virtual', 0x6F: 'invoke-super', 0x70: 'invoke-direct',
           0x0A: 'move-result', 0x1F: 'check-cast', 0x38: 'if-eqz', 0x14: 'const'}
    for group, count in (('direct', dm), ('virtual', vm)):
        idx = 0
        for _ in range(count):
            d, p = uleb(dex, p); idx += d
            fl, p = uleb(dex, p)
            code, p = uleb(dex, p)
            regs, ins, outs, tries, dbg, n = struct.unpack('<HHHHII', dex[code:code + 16])
            check(code % 4 == 0, f'{group} {meths[idx]} code aligned, regs={regs} ins={ins} outs={outs}')
            u = struct.unpack('<%dH' % n, dex[code + 16:code + 16 + 2 * n])
            k = 0
            max_out = 0
            starts, ins_at = [], set()
            while k < n:
                ins_at.add(k)
                op = u[k] & 0xFF
                hi = u[k] >> 8
                name = OPS.get(op)
                check(name is not None, f'    opcode 0x{op:02x} known')
                if op in (0x6E, 0x6F, 0x70):
                    a, g = hi >> 4, hi & 0xF
                    rr = [u[k + 2] & 0xF, (u[k + 2] >> 4) & 0xF, (u[k + 2] >> 8) & 0xF, (u[k + 2] >> 12) & 0xF, g][:a]
                    max_out = max(max_out, a)
                    m = meths[u[k + 1]]
                    pd, words, q = m.split('(')[1].split(')')[0], 1, 0
                    while q < len(pd):
                        if pd[q] == 'L':
                            q = pd.index(';', q) + 1; words += 1
                        else:
                            words += 2 if pd[q] in 'JD' else 1; q += 1
                    nargs = words
                    check(nargs == a and all(r < regs for r in rr), f'    {name} {{{", ".join("v%d" % r for r in rr)}}}, {m}')
                    k += 3
                elif op == 0x38:
                    off = u[k + 1] - (0x10000 if u[k + 1] & 0x8000 else 0)
                    tgt = k + off
                    check(0 <= tgt < n and hi < regs, f'           if-eqz v{hi}, +{off} -> {tgt}')
                    starts.append(tgt)
                    k += 2
                elif op in (0x1A, 0x22, 0x1F):
                    ref = strs[u[k + 1]] if op == 0x1A else types[u[k + 1]]
                    ins_at.add(k)
                    print(f'           {name} v{hi}, {ref!r}')
                    k += 2
                elif op == 0x14:
                    print(f'           const v{hi}, 0x{u[k + 1] | (u[k + 2] << 16):08X}')
                    k += 3
                elif op == 0x13:
                    print(f'           {name} v{hi}, {u[k + 1]}')
                    k += 2
                elif op == 0x12:
                    print(f'           {name} v{hi & 0xF}, {hi >> 4}')
                    k += 1
                else:
                    print(f'           {name}' + (f' v{hi}' if op in (0x0C, 0x0A) else ''))
                    k += 1
            check(all(t in ins_at for t in starts), '    branch targets land on instruction starts')
            check(n and (u[-1] & 0xFF) == 0x0E, '    ends with return')
            check(max_out <= outs, f'    outs {outs} covers largest call ({max_out})')

# ---------------- manifest
print('MANIFEST')
ax = z.read('AndroidManifest.xml')
typ, hs, size = struct.unpack('<HHI', ax[:8])
check(typ == 3 and size == len(ax), 'xml chunk header')


def pool(b, off):
    t, h, sz, cnt, stc, flags, sstart, _ = struct.unpack('<HHIIIIII', b[off:off + 28])
    out = []
    for i in range(cnt):
        o = off + sstart + struct.unpack('<I', b[off + 28 + 4 * i:off + 32 + 4 * i])[0]
        if flags & 0x100:
            n = b[o]; o += 1 if n < 0x80 else 2
            m = b[o]
            if m & 0x80:
                m = ((m & 0x7F) << 8) | b[o + 1]; o += 2
            else:
                o += 1
            out.append(b[o:o + m].decode('utf-8'))
        else:
            n = struct.unpack('<H', b[o:o + 2])[0]
            out.append(b[o + 2:o + 2 + 2 * n].decode('utf-16-le'))
    return out, off + sz


S, off = pool(ax, 8)
t, h, sz = struct.unpack('<HHI', ax[off:off + 8])
resids = struct.unpack('<%dI' % ((sz - 8) // 4), ax[off + 8:off + sz])
off += sz
depth = 0
while off < len(ax):
    t, h, sz = struct.unpack('<HHI', ax[off:off + 8])
    if t == 0x0102:
        ns, nm, ast, asz, ac = struct.unpack('<IIHHH', ax[off + 16:off + 30])
        attrs = []
        for i in range(ac):
            a = off + 16 + ast + i * asz
            ans, an, raw, vs, _, dt, dv = struct.unpack('<IIIHBBI', ax[a:a + 20])
            v = S[dv] if dt == 3 else ('true' if dv else 'false') if dt == 0x12 else hex(dv) if dt in (1, 0x11) else dv
            rid = hex(resids[an]) if an < len(resids) else '-'
            attrs.append(f'{"android:" if ans != 0xFFFFFFFF else ""}{S[an]}="{v}"[{rid}]')
        print('    ' + '  ' * depth + f'<{S[nm]} ' + ' '.join(attrs) + '>')
        depth += 1
    elif t == 0x0103:
        depth -= 1
    off += sz
check(depth == 0, 'elements balanced')

# ---------------- resources
print('RESOURCES')
rs = z.read('resources.arsc')
t, h, sz, npk = struct.unpack('<HHII', rs[:12])
check(t == 2 and sz == len(rs) and npk == 1, 'table header')
G, off = pool(rs, 12)
t, h, psz, pid = struct.unpack('<HHII', rs[off:off + 12])
pname = rs[off + 12:off + 268].decode('utf-16-le').rstrip('\x00')
tso, lpt, kso, lpk, tio = struct.unpack('<5I', rs[off + 268:off + 288])
TS, _ = pool(rs, off + tso)
KS, _ = pool(rs, off + kso)
check(pid == 0x7F and h == 288 and off + psz == len(rs), f'package {pname} id 0x7f')
p = off + h + (len(rs[off + tso:]) and 0)
p = off + kso + struct.unpack('<I', rs[off + kso + 4:off + kso + 8])[0]
# 3.8 起资源表由 aapt2 生成（布局、颜色、图标，多种配置）：列出每个类型的条目，文件型资源要在 apk 里
nent = 0
while p < len(rs):
    t, hh, sz = struct.unpack('<HHI', rs[p:p + 8])
    if t == 0x0201:
        tid, _, _, cnt, est = struct.unpack('<BBHII', rs[p + 8:p + 20])
        for i in range(cnt):
            eo = struct.unpack('<I', rs[p + hh + 4 * i:p + hh + 4 * i + 4])[0]
            if eo == 0xFFFFFFFF:
                continue
            e = p + est + eo
            esz, efl, key = struct.unpack('<HHI', rs[e:e + 8])
            nent += 1
            if efl & 1:
                continue            # 复杂资源（样式等）
            vsz, _, vdt, vd = struct.unpack('<HBBI', rs[e + 8:e + 16])
            if vdt == 0x03 and vd < len(G) and G[vd].startswith('res/'):
                check(G[vd] in z.namelist(), f'    0x7f{tid:02x}{i:04x} {TS[tid - 1]}/{KS[key]} -> {G[vd]} exists')
    p += sz
check(nent > 0, f'{nent} resource entries')
print('ALL CHECKS PASSED' if ok else 'SOME CHECKS FAILED')
sys.exit(0 if ok else 1)
