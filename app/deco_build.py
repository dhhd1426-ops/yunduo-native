"""生成首页问候语旁的“蝶环”装饰（方案 ③）：www/fonts/deco-arc.js"""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'namecanvas'))
from art import rose_sprig, grass_tuft, butterfly, smooth

INK = '#010101'          # 占位色：App 里用 CSS 换成主题对应的墨色
PETAL, DEEP, LEAF = '#e6a2ac', '#b85466', '#7f9a78'


def at(x, y, inner, s=1, rot=0, cls='', seq=None):
    a = f' class="{cls}"' if cls else ''
    q = f' data-seq="{seq}"' if seq is not None else ''
    return f'<g transform="translate({x} {y}) rotate({rot}) scale({s})"{q}><g{a}>{inner}</g></g>'


# 小狐狸坐在右下角（HTML 图层，不在这里画）；玫瑰在它右后方，蝴蝶沿弧线在它头顶上方
arc = [(372, 150, .2, 'swallow', 20, .7), (352, 120, .26, 'blue', -25, 1), (374, 92, .13, 'admiral', -40, .8),
       (330, 88, .16, 'sulphur', 30, .6), (296, 78, .12, 'rose', 12, .85), (262, 76, .09, 'blue', -15, .6),
       (232, 82, .07, 'sulphur', 25, .7), (386, 214, .15, 'rose', -10, .9)]
out = []
out.append(at(300, 272, grass_tuft(INK, LEAF, seed=31, n=6, h=16, sw=.45, heads=1), 1, 0, 'sway', 0))
out.append(at(384, 272, rose_sprig(INK, PETAL, DEEP, LEAF, seed=9, sw=.6, buds=1), .62, 6, 'sway slow', 1))
trail = smooth([(386, 226), (392, 180), (370, 118), (320, 84), (220, 84)])
out.append(f'<g data-seq="2"><mask id="dk-trail" maskUnits="userSpaceOnUse" x="150" y="0" width="300" height="320">'
           f'<path class="ink" d="{trail}" fill="none" stroke="#fff" stroke-width="5"/></mask>'
           f'<path class="trail" d="{trail}" fill="none" stroke="{INK}" stroke-width=".6" stroke-dasharray="1.2 3.4" stroke-linecap="round" opacity=".7" mask="url(#dk-trail)"/></g>')
for i, (x, y, s_, sp, r, o) in enumerate(arc):
    out.append(f'<g transform="translate({x} {y})" data-seq="{3 + i}" class="bfly">{butterfly(sp, INK, s_, r, o, seed=int(x))}</g>')
out.append(at(372, 272, grass_tuft(INK, LEAF, seed=37, n=5, h=12, sw=.45, heads=0), 1, 0, 'sway', 0))
# 小狐狸走过的地方：几丛很淡的小草，像走在草地边上
for gx, sd, hh in [(238, 41, 8), (262, 43, 10), (284, 45, 7)]:
    out.append(f'<g opacity=".7">' + at(gx, 272, grass_tuft(INK, LEAF, seed=sd, n=4, h=hh, sw=.4, heads=0), 1, 0, 'sway', 0) + '</g>')
svg = ''.join(out)
js = 'window.DECO_ARC=' + json.dumps({'viewBox': '196 58 196 228', 'svg': svg}, ensure_ascii=False) + ';'
open(os.path.join(HERE, 'www', 'fonts', 'deco-arc.js'), 'w', encoding='utf-8').write(js)
print('deco bytes', len(js.encode()), 'ink paths', svg.count('class="ink"'))
