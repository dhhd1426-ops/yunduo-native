# 云朵天气 · WE 基础素材替身：生成 materials/util/*.tex 和常用粒子贴图（WE 安装目录自带、创意工坊包里不带的那些）
# 全部是程序生成的近似图，不含 WE 原素材。用法：python3 gen_tex.py [输出 assets 目录，默认本脚本所在目录]
# 格式：TEXV0005 / TEXI0001 / TEXB0003，RGBA8888 不压缩，1 级 mip（渲染器的 WPTexImageParser 能直接读）
import os
import struct
import sys

import numpy as np

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
CLAMP = 2  # 标志位 1 = clampUVs；0 = 平铺（噪声图要平铺）


def tex(name, rgba, flags=CLAMP):
    rgba = np.clip(np.asarray(rgba, dtype=np.float64), 0, 255).round().astype(np.uint8)
    h, w = rgba.shape[:2]
    data = rgba.tobytes()
    b = b'TEXV0005\0TEXI0001\0' + struct.pack('<iIiiiii', 0, flags, w, h, w, h, 0)
    b += b'TEXB0003\0' + struct.pack('<iiiiiiii', 1, -1, 1, w, h, 0, 0, len(data)) + data
    p = os.path.join(OUT, 'materials', name + '.tex')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'wb') as f:
        f.write(b)


def solid(c, n=4):
    return np.tile(np.array(c, dtype=np.float64), (n, n, 1))


def grid(w, h):
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    return (x + 0.5) / w, (y + 0.5) / h


def white_alpha(a):
    a = np.clip(a, 0, 1)
    out = np.empty(a.shape + (4,))
    out[..., :3] = 255
    out[..., 3] = a * 255
    return out


rng = np.random.default_rng(20261007)

# ---------- util ----------
tex('util/white', solid([255, 255, 255, 255]))
tex('util/black', solid([0, 0, 0, 255]))
tex('util/clearalpha', solid([0, 0, 0, 0]))
tex('util/noflow', solid([127, 127, 0, 255]))          # 流动贴图：(0.5, 0.5) = 不动
tex('util/flatnormal', solid([128, 128, 255, 255]))    # 平的法线


def smooth_noise(n, octaves, seed):
    r = np.random.default_rng(seed)
    acc = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        k = 4 * 2 ** o
        g = r.random((k, k))
        u, v = grid(n, n)
        x, y = u * k, v * k
        x0, y0 = np.floor(x).astype(int) % k, np.floor(y).astype(int) % k
        x1, y1 = (x0 + 1) % k, (y0 + 1) % k
        fx, fy = x - np.floor(x), y - np.floor(y)
        fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        val = (g[y0, x0] * (1 - fx) + g[y0, x1] * fx) * (1 - fy) + (g[y1, x0] * (1 - fx) + g[y1, x1] * fx) * fy
        acc += val * amp
        tot += amp
        amp *= 0.5
    return acc / tot


pn = smooth_noise(256, 5, 7) * 255
# util/noise：平滑、可平铺的三通道噪声（WE 的特效拿它做扰动，比如 foliagesway 的「噪声」模式；
# 以前是逐像素白噪声，放大采样后扰动一块一块的，头发上出现阶梯状方块）
nz = [smooth_noise(256, 4, s0) for s0 in (21, 22, 23)]
nz = [(c - c.min()) / max(1e-6, c.max() - c.min()) * 255 for c in nz]
tex('util/noise', np.dstack(nz + [np.full((256, 256), 255.0)]), flags=0)
tex('util/perlin_256', np.dstack([pn, pn, pn, np.full_like(pn, 255)]), flags=0)

# ---------- 粒子 ----------
# 柔和圆光点
u, v = grid(64, 64)
r = np.minimum(1, np.hypot(u - .5, v - .5) * 2)
tex('particle/halo', white_alpha((1 - r) ** 2.2))

# 水滴痕（拖尾用：u 横跨、v 沿长度）
u, v = grid(32, 128)
a = np.exp(-((u - .5) ** 2) / (2 * .12 ** 2)) * np.clip(1 - np.abs(v - .5) * 2, 0, 1) ** .7
tex('particle/drop', white_alpha(a))
# 水滴法线：横向是个圆柱面
nx = np.clip((u - .5) * 2, -1, 1) * np.clip(1 - np.abs(v - .5) * 2, 0, 1)
tex('particle/drop_normal', np.dstack([nx * 127 + 128, np.full_like(u, 128), np.sqrt(np.clip(1 - nx * nx, 0, 1)) * 127 + 128, a * 255]))

# 雨丝图：一大张里散落几十根细长雨丝（WE 的「大雨」用 800–1600 像素的大粒子贴这一张）
W, H = 256, 512
img = np.zeros((H, W))
u, v = grid(W, H)
for _ in range(34):
    cx, cy = rng.random(), rng.random()
    ln = rng.uniform(.08, .28)
    wd = rng.uniform(.0018, .0035)
    al = rng.uniform(.12, .42)
    dx = np.abs(((u - cx + .5) % 1) - .5) * W / H
    dy = ((v - cy + .5) % 1) - .5
    img = np.maximum(img, al * np.exp(-(dx ** 2) / (2 * wd ** 2)) * np.clip(1 - np.abs(dy) / (ln / 2), 0, 1) ** .8)
tex('particle/nature/rain1', white_alpha(img))
tex('particle/nature/rain2', white_alpha(img[::-1, ::-1]))

# 雾团：软边 + 低频噪声
n = 128
u, v = grid(n, n)
r = np.hypot(u - .5, v - .5) * 2
fog = np.clip(1 - r, 0, 1) ** 1.4 * (.55 + .45 * smooth_noise(n, 4, 11))
tex('particle/fog/fog1', white_alpha(fog * .8))
tex('particle/fog/fog2', white_alpha(np.clip(1 - r, 0, 1) ** 1.8 * (.5 + .5 * smooth_noise(n, 4, 12)) * .8))
tex('particle/smoke1', white_alpha(np.clip(1 - r, 0, 1) ** 1.6 * (.5 + .5 * smooth_noise(n, 4, 13)) * .7))

# 碎屑：不规则的小碎片（颜色由粒子决定，这里白色）
n = 64
u, v = grid(n, n)
ang = np.arctan2(v - .5, u - .5)
rad = np.hypot(u - .5, v - .5) * 2
edge = .55 + .18 * np.sin(ang * 3 + 1.3) + .1 * np.sin(ang * 7 + .4)
tex('particle/debris/debris1', white_alpha(np.clip((edge - rad) * 12, 0, 1)))

# 色散光点：中心白，边缘红蓝错开
n = 64
u, v = grid(n, n)
rr = [np.hypot(u - .5, v - .5) * 2 * s for s in (1.0, .93, .86)]
ch = [np.clip(1 - x, 0, 1) ** 2 for x in rr]
tex('particle/chromaticdot', np.dstack([ch[0] * 255, ch[1] * 255, ch[2] * 255, np.maximum.reduce(ch) * 255]))

# 雪花点
tex('particle/snowflake', white_alpha(np.clip(1 - np.hypot(u - .5, v - .5) * 2.2, 0, 1) ** 1.2))

# 向心扭转的法线贴图（折射用）
n = 64
u, v = grid(n, n)
dx, dy = u - .5, v - .5
rad = np.hypot(dx, dy) * 2
fall = np.clip(1 - rad, 0, 1)
nx, ny = (-dy - dx * .5) * fall * 1.6, (dx - dy * .5) * fall * 1.6
nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0, 1))
tex('particle/normal_pinch_rotate', np.dstack([nx * 127 + 128, ny * 127 + 128, nz * 127 + 128, fall * 255]))

print('ok', OUT)
