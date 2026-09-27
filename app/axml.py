"""Binary AndroidManifest.xml and resources.arsc writers."""
import struct

ANDROID_NS = 'http://schemas.android.com/apk/res/android'

# attribute name -> framework resource id
ATTR_IDS = {
    'theme': 0x01010000, 'label': 0x01010001, 'icon': 0x01010002, 'name': 0x01010003,
    'hasCode': 0x0101000c, 'debuggable': 0x0101000f, 'exported': 0x01010010, 'configChanges': 0x0101001f,
    'minSdkVersion': 0x0101020c, 'versionCode': 0x0101021b, 'versionName': 0x0101021c,
    'targetSdkVersion': 0x01010270, 'allowBackup': 0x01010280, 'usesCleartextTraffic': 0x010104ec,
}

T_REF, T_STRING, T_INT_DEC, T_INT_HEX, T_BOOL = 0x01, 0x03, 0x10, 0x11, 0x12


def string_pool(strings, utf8=False):
    offsets, data = [], bytearray()
    for s in strings:
        offsets.append(len(data))
        if utf8:
            b = s.encode('utf-8')
            def l8(n):
                return bytes([n]) if n < 0x80 else bytes([0x80 | (n >> 8), n & 0xFF])
            data += l8(len(s)) + l8(len(b)) + b + b'\x00'
        else:
            u = s.encode('utf-16-le')
            n = len(u) // 2
            assert n < 0x8000
            data += struct.pack('<H', n) + u + b'\x00\x00'
    while len(data) % 4:
        data.append(0)
    header_size = 28
    strings_start = header_size + 4 * len(strings)
    size = strings_start + len(data)
    flags = 0x100 if utf8 else 0
    out = struct.pack('<HHIIIIII', 0x0001, header_size, size, len(strings), 0, flags, strings_start, 0)
    out += b''.join(struct.pack('<I', o) for o in offsets) + bytes(data)
    return out


class Manifest:
    """Build a manifest from a nested tuple tree: (tag, [(ns_is_android, name, type, value)], [children])."""

    def __init__(self, root):
        self.root = root

    def build(self):
        # collect attribute names that have resource ids first (resource map order)
        res_names = []
        other = []

        def walk(node):
            tag, attrs, kids = node
            for (is_android, name, _t, val) in attrs:
                if is_android:
                    if name not in res_names:
                        res_names.append(name)
                else:
                    if name not in other:
                        other.append(name)
                if _t == T_STRING and val not in other:
                    other.append(val)
            if tag not in other:
                other.append(tag)
            for k in kids:
                walk(k)
        walk(self.root)
        res_names.sort(key=lambda n: ATTR_IDS[n])
        strings = list(res_names)
        for s in ['android', ANDROID_NS] + other:
            if s not in strings:
                strings.append(s)
        idx = {s: i for i, s in enumerate(strings)}

        body = bytearray()
        body += string_pool(strings)
        resmap = b''.join(struct.pack('<I', ATTR_IDS[n]) for n in res_names)
        body += struct.pack('<HHI', 0x0180, 8, 8 + len(resmap)) + resmap

        line = [1]

        def node_start(tag, attrs):
            attrs = sorted(attrs, key=lambda a: (ATTR_IDS[a[1]] if a[0] else 0x7FFFFFFF, a[1]))
            ab = bytearray()
            for (is_android, name, t, val) in attrs:
                ns = idx[ANDROID_NS] if is_android else 0xFFFFFFFF
                if t == T_STRING:
                    raw, data = idx[val], idx[val]
                elif t == T_BOOL:
                    raw, data = 0xFFFFFFFF, 0xFFFFFFFF if val else 0
                else:
                    raw, data = 0xFFFFFFFF, val
                ab += struct.pack('<IIIHBBI', ns, idx[name], raw, 8, 0, t, data)
            ext = struct.pack('<IIHHHHHH', 0xFFFFFFFF, idx[tag], 20, 20, len(attrs), 0, 0, 0)
            chunk = struct.pack('<HHIII', 0x0102, 16, 16 + len(ext) + len(ab), line[0], 0xFFFFFFFF) + ext + ab
            line[0] += 1
            return chunk

        def node_end(tag):
            chunk = struct.pack('<HHIIIII', 0x0103, 16, 24, line[0], 0xFFFFFFFF, 0xFFFFFFFF, idx[tag])
            line[0] += 1
            return chunk

        def emit(node):
            tag, attrs, kids = node
            out = node_start(tag, attrs)
            for k in kids:
                out += emit(k)
            return out + node_end(tag)

        ns_start = struct.pack('<HHIIIII', 0x0100, 16, 24, 1, 0xFFFFFFFF, idx['android'], idx[ANDROID_NS])
        ns_end = struct.pack('<HHIIIII', 0x0101, 16, 24, line[0] + 100, 0xFFFFFFFF, idx['android'], idx[ANDROID_NS])
        body += ns_start + emit(self.root) + ns_end
        return struct.pack('<HHI', 0x0003, 8, 8 + len(body)) + bytes(body)


def resources_arsc(package_name, type_name, key_name, file_path, density):
    """One package (0x7f) with one resource 0x7f010000 of type `type_name` pointing to `file_path`."""
    global_pool = string_pool([file_path], utf8=True)
    type_pool = string_pool([type_name], utf8=True)
    key_pool = string_pool([key_name], utf8=True)

    # typeSpec
    spec = struct.pack('<HHIBBHI', 0x0202, 16, 16 + 4, 1, 0, 0, 1) + struct.pack('<I', 0)

    # type with config
    config = bytearray(64)
    struct.pack_into('<I', config, 0, 64)
    struct.pack_into('<H', config, 14, density)
    entry = struct.pack('<HHI', 8, 0, 0) + struct.pack('<HBBI', 8, 0, T_STRING, 0)
    header_size = 20 + 64
    entries_start = header_size + 4
    ttype = struct.pack('<HHIBBHII', 0x0201, header_size, entries_start + len(entry), 1, 0, 0, 1, entries_start)
    ttype += bytes(config) + struct.pack('<I', 0) + entry

    name = package_name.encode('utf-16-le')[:254]
    name = name + b'\x00' * (256 - len(name))
    pkg_header_size = 288
    type_strings_off = pkg_header_size
    key_strings_off = type_strings_off + len(type_pool)
    pkg_body = type_pool + key_pool + spec + ttype
    pkg = struct.pack('<HHII', 0x0200, pkg_header_size, pkg_header_size + len(pkg_body), 0x7F) + name + \
        struct.pack('<IIIII', type_strings_off, 1, key_strings_off, 1, 0) + pkg_body
    assert len(pkg) == pkg_header_size + len(pkg_body)
    body = global_pool + pkg
    return struct.pack('<HHII', 0x0002, 12, 12 + len(body), 1) + body
