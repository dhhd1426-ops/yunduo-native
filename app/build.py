import os, sys, struct
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from dex import build_webview_dex
from axml import Manifest, resources_arsc, T_STRING, T_INT_DEC, T_INT_HEX, T_BOOL, T_REF
from pack import write_zip, make_key, sign_v2

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = 'com.cloudweather.xiaoyu'
ACT = PKG + '.MainActivity'
ACT_DESC = 'L' + ACT.replace('.', '/') + ';'


def make_icon(path, size=192):
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ink, rose, ivory = (40, 58, 110, 255), (227, 166, 176, 255), (245, 248, 251, 255)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=ink)
    # sun
    cx, cy, r = S * 0.62, S * 0.38, S * 0.15
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rose)
    # cloud
    y = S * 0.62
    for (x0, y0, rr) in [(0.30, 0.0, 0.13), (0.45, -0.07, 0.16), (0.60, 0.0, 0.12), (0.40, 0.04, 0.12)]:
        x, yy, rad = S * x0, y + S * y0, S * rr
        d.ellipse([x - rad, yy - rad, x + rad, yy + rad], fill=ivory)
    d.rounded_rectangle([S * 0.20, y - S * 0.02, S * 0.72, y + S * 0.13], radius=int(S * 0.07), fill=ivory)
    im = im.resize((size, size), Image.LANCZOS)
    im.save(path, optimize=True)
    return open(path, 'rb').read()


# 3.8 起原生层用 Java 写、在 GitHub Actions 上用官方 SDK 编译（见 native/README），产物放在 apk/native/classes.dex。
# 没有这个文件时退回 dex.py 手写的旧版（只有 WebView，没有通知）。
NATIVE_DEX = os.environ.get('YD_DEX') or os.path.join(HERE, 'native', 'classes.dex')
if not os.path.exists(NATIVE_DEX):
    NATIVE_DEX = None
DEBUGGABLE = os.environ.get('YD_DEBUG') == '1'      # 只给 CI 模拟器测试用，正式包永远是 False
MIN_SDK = 26 if NATIVE_DEX else 24
PERMS = ['INTERNET'] + (['POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'VIBRATE', 'SCHEDULE_EXACT_ALARM'] if NATIVE_DEX else [])
RECEIVER_ACTIONS = ['android.intent.action.BOOT_COMPLETED', 'android.intent.action.MY_PACKAGE_REPLACED',
                    'android.intent.action.TIME_SET', 'android.intent.action.TIMEZONE_CHANGED',
                    'android.intent.action.QUICKBOOT_POWERON']


def manifest():
    A = True
    root = ('manifest', [
        (False, 'package', T_STRING, PKG),
        (A, 'versionCode', T_INT_DEC, 28),
        (A, 'versionName', T_STRING, '3.7'),
    ], [
        ('uses-sdk', [(A, 'minSdkVersion', T_INT_DEC, MIN_SDK), (A, 'targetSdkVersion', T_INT_DEC, 29)], []),
    ] + [('uses-permission', [(A, 'name', T_STRING, 'android.permission.' + p)], []) for p in PERMS] + [
        ('application', [
            (A, 'label', T_STRING, '云朵天气'),
            (A, 'icon', T_REF, 0x7F010000),
            (A, 'allowBackup', T_BOOL, True),
        ] + ([(A, 'debuggable', T_BOOL, True)] if DEBUGGABLE else []), [
            ('activity', [
                (A, 'name', T_STRING, ACT),
                (A, 'label', T_STRING, '云朵天气'),
                (A, 'exported', T_BOOL, True),
                (A, 'configChanges', T_INT_HEX, 0x0DA0),
            ], [
                ('intent-filter', [], [
                    ('action', [(A, 'name', T_STRING, 'android.intent.action.MAIN')], []),
                    ('category', [(A, 'name', T_STRING, 'android.intent.category.LAUNCHER')], []),
                ]),
            ]),
        ] + ([
            # 3.8 通知模块：闹钟到点、通知按钮、开机/更新后重排
            ('receiver', [
                (A, 'name', T_STRING, PKG + '.AmorReceiver'),
                (A, 'exported', T_BOOL, True),
            ], [
                ('intent-filter', [], [('action', [(A, 'name', T_STRING, a)], []) for a in RECEIVER_ACTIONS]),
            ]),
        ] if NATIVE_DEX else [])),
    ])
    return Manifest(root).build()


def main(out_path):
    work = os.path.join(HERE, 'build')
    os.makedirs(work, exist_ok=True)
    icon = make_icon(os.path.join(work, 'icon.png'))
    dex = open(NATIVE_DEX, 'rb').read() if NATIVE_DEX else build_webview_dex(ACT_DESC, 'file:///android_asset/index.html')
    print('dex:', NATIVE_DEX or 'dex.py (WebView only)', len(dex), 'bytes', '· debuggable' if DEBUGGABLE else '')
    arsc = resources_arsc(PKG, 'mipmap', 'ic_launcher', 'res/mipmap/ic_launcher.png', 640)
    man = manifest()
    html = open(os.path.join(HERE, 'www', 'index.html'), 'rb').read()
    for name, blob in [('AndroidManifest.xml', man), ('classes.dex', dex), ('resources.arsc', arsc)]:
        open(os.path.join(work, name), 'wb').write(blob)
    entries = [
        ('AndroidManifest.xml', man, True),
        ('classes.dex', dex, True),
        ('resources.arsc', arsc, False),
        ('res/mipmap/ic_launcher.png', icon, False),
        ('assets/index.html', html, True),
    ]
    fonts_dir = os.path.join(HERE, 'www', 'fonts')
    if os.path.isdir(fonts_dir):
        for fn in sorted(os.listdir(fonts_dir)):
            # woff 已经压缩过，原样存放
            entries.append(('assets/fonts/' + fn, open(os.path.join(fonts_dir, fn), 'rb').read(), False))
    blob, central, eocd = write_zip(entries)
    key, cert, pub = make_key(HERE)
    apk, digest = sign_v2(blob, central, eocd, key, cert, pub)
    open(out_path, 'wb').write(apk)
    print('wrote', out_path, len(apk), 'bytes; v2 digest', digest.hex()[:16])


if __name__ == '__main__':
    main(sys.argv[1])
