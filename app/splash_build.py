"""开屏用的原创线描：信纸上的一枝玫瑰、火漆印上的小玫瑰。输出 www/fonts/splash-art.js"""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'namecanvas'))
from art import rose_sprig, grass_tuft, butterfly, rose as rose_head

SEPIA = '#3b3226'
rose = rose_sprig(SEPIA, '#e6a2ac', '#b85466', '#8fa878', seed=21, sw=.36, buds=1)
grass = grass_tuft(SEPIA, '#8fa878', seed=33, n=5, h=14, sw=.3, heads=1)
grass2 = grass_tuft(SEPIA, '#8fa878', seed=34, n=4, h=10, sw=.3, heads=0)
art = f'<g transform="translate(16 0)">{grass}</g><g transform="translate(-13 0)">{grass2}</g><g>{rose}</g>'
emblem = rose_head('#f6dede', '#d98894', '#8e3440', 16, 5, .6)
BINK = '#4a3b30'
# 落点（开屏舞台坐标，信纸在 30,120 起、300×440）：像老博物图谱里散落的蝴蝶
FLOCK = [  # 品种, 大小, 落点 x, y, 停下时的角度, 停下时翅膀张开度, 弧线弯度, 转圈半径, 转圈方向
    ('rose',    .46,  38, 128, -28, 1.0,  70, 26,  1),
    ('swallow', .38, 318, 548,  24, .9, -60, 30, -1),
    ('admiral', .19,  33, 428, -14, .75, 80, 18,  1),
    ('blue',    .20, 326, 232,  32, .8, -70, 20, -1),
    ('blue',    .15,  44, 552, -30, .8,  60, 16,  1),
    ('sulphur', .13, 318, 264,   8, .7, -40, 14,  1),
    ('rose',    .14, 290, 572, -10, .8, -30, 14, -1),
    ('blue',    .12,  74, 114,  18, .55, 40, 12, -1),
    ('sulphur', .09, 214, 214,  22, .6, -20, 10,  1),
]
flock = [{'svg': butterfly(sp, BINK, 1, 0, 1, seed=int(x * 3 + y)), 's': sc, 'x': x, 'y': y, 'rot': r, 'open': op, 'bend': bd, 'r': round(max(rr * 1.6, 20), 1), 'dir': dr}
         for (sp, sc, x, y, r, op, bd, rr, dr) in FLOCK]
js = 'window.SPLASH_ART=' + json.dumps({'flock': flock, 'rose': art, 'roseBox': '-44 -112 88 118', 'emblem': emblem, 'emblemBox': '-20 -20 40 40'}, ensure_ascii=False) + ';'
open(os.path.join(HERE, 'www', 'fonts', 'splash-art.js'), 'w', encoding='utf-8').write(js)
print('bytes', len(js.encode()))
