"""Zip writer with alignment + APK Signature Scheme v2 signer (uses openssl for RSA)."""
import struct, zlib, hashlib, subprocess, os, tempfile

DOS_TIME, DOS_DATE = 0, (2026 - 1980) << 9 | 9 << 5 | 26


def write_zip(entries, align=4):
    """entries: list of (name, bytes, compress: bool). Stored entries are aligned to `align` bytes."""
    out = bytearray()
    central = bytearray()
    for name, data, compress in entries:
        nb = name.encode('utf-8')
        crc = zlib.crc32(data) & 0xFFFFFFFF
        if compress:
            co = zlib.compressobj(9, zlib.DEFLATED, -15)
            comp = co.compress(data) + co.flush()
            method = 8
        else:
            comp = data
            method = 0
        offset = len(out)
        extra = b''
        if method == 0:
            pad = (align - (offset + 30 + len(nb)) % align) % align
            extra = b'\x00' * pad
        out += struct.pack('<IHHHHHIIIHH', 0x04034B50, 20, 0x0800, method, DOS_TIME, DOS_DATE,
                           crc, len(comp), len(data), len(nb), len(extra)) + nb + extra + comp
        central += struct.pack('<IHHHHHHIIIHHHHHII', 0x02014B50, 20, 20, 0x0800, method, DOS_TIME, DOS_DATE,
                               crc, len(comp), len(data), len(nb), 0, 0, 0, 0, 0, offset) + nb
    cd_off = len(out)
    eocd = struct.pack('<IHHHHIIH', 0x06054B50, 0, 0, len(entries), len(entries), len(central), cd_off, 0)
    return bytes(out), bytes(central), bytearray(eocd)


def lp(b):
    return struct.pack('<I', len(b)) + b


def chunk_digest(sections):
    digests = []
    for sec in sections:
        for i in range(0, len(sec), 1 << 20):
            c = sec[i:i + (1 << 20)]
            digests.append(hashlib.sha256(b'\xa5' + struct.pack('<I', len(c)) + c).digest())
    return hashlib.sha256(b'\x5a' + struct.pack('<I', len(digests)) + b''.join(digests)).digest()


def make_key(workdir):
    key = os.path.join(workdir, 'key.pem')
    cert = os.path.join(workdir, 'cert.der')
    if not os.path.exists(key):
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
                        '-outform', 'DER', '-out', cert, '-days', '10000', '-sha256',
                        '-subj', '/CN=Cloud Weather/O=Cloud Weather'], check=True, capture_output=True)
    pub = subprocess.run(['openssl', 'pkey', '-in', key, '-pubout', '-outform', 'DER'],
                         check=True, capture_output=True).stdout
    return key, open(cert, 'rb').read(), pub


def rsa_sign(key, data):
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(data)
        path = f.name
    try:
        return subprocess.run(['openssl', 'dgst', '-sha256', '-sign', key, path],
                              check=True, capture_output=True).stdout
    finally:
        os.unlink(path)


def sign_v2(entries_blob, central, eocd, key, cert_der, pub_der):
    cd_off = len(entries_blob)
    # digest over: entries, central directory, eocd (with cd offset = start of signing block = cd_off)
    e = bytearray(eocd)
    struct.pack_into('<I', e, 16, cd_off)
    digest = chunk_digest([entries_blob, central, bytes(e)])
    ALG = 0x0103  # RSASSA-PKCS1-v1_5 with SHA2-256
    digests = lp(lp(struct.pack('<I', ALG) + lp(digest)))
    certs = lp(lp(cert_der))
    signed_data = digests + certs + lp(b'')
    sig = rsa_sign(key, signed_data)
    signatures = lp(lp(struct.pack('<I', ALG) + lp(sig)))
    signer = lp(signed_data) + signatures + lp(pub_der)
    value = lp(lp(signer))
    pair = struct.pack('<Q', 4 + len(value)) + struct.pack('<I', 0x7109871A) + value
    block_size = len(pair) + 8 + 16
    block = struct.pack('<Q', block_size) + pair + struct.pack('<Q', block_size) + b'APK Sig Block 42'
    e2 = bytearray(eocd)
    struct.pack_into('<I', e2, 16, cd_off + len(block))
    return entries_blob + block + central + bytes(e2), digest
