// 云朵天气安卓移植：BC1/BC2/BC3（DXT1/3/5）压缩贴图的 CPU 解码。
// 手机 GPU（Mali、Adreno、PowerVR）基本都不支持 BC 格式，Wallpaper Engine 的贴图却常用（.tex 格式 4/5/6/7），
// 设备不支持时上传前在 CPU 上解成 RGBA8。被 TextureCache.cpp 包含（拷进上游 src/Vulkan/ 下）。
#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace yd_bc
{
// kind: 1 = BC1, 2 = BC2, 3 = BC3
inline std::size_t blockBytes(int kind) { return kind == 1 ? 8 : 16; }
inline std::size_t compressedSize(int kind, int w, int h) {
    return (std::size_t)((w + 3) / 4) * (std::size_t)((h + 3) / 4) * blockBytes(kind);
}

inline void color565(uint16_t c, uint8_t* o) {
    int r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
    o[0] = (uint8_t)((r << 3) | (r >> 2));
    o[1] = (uint8_t)((g << 2) | (g >> 4));
    o[2] = (uint8_t)((b << 3) | (b >> 2));
    o[3] = 255;
}

// 颜色块（8 字节）→ 16 个 RGBA；bc1Mode：BC1 里 c0<=c1 时第 4 色是透明黑
inline void colorBlock(const uint8_t* s, uint8_t out[16][4], bool bc1Mode) {
    uint16_t c0 = (uint16_t)(s[0] | (s[1] << 8)), c1 = (uint16_t)(s[2] | (s[3] << 8));
    uint8_t  pal[4][4];
    color565(c0, pal[0]);
    color565(c1, pal[1]);
    if (! bc1Mode || c0 > c1) {
        for (int k = 0; k < 3; k++) {
            pal[2][k] = (uint8_t)((2 * pal[0][k] + pal[1][k] + 1) / 3);
            pal[3][k] = (uint8_t)((pal[0][k] + 2 * pal[1][k] + 1) / 3);
        }
        pal[2][3] = pal[3][3] = 255;
    } else {
        for (int k = 0; k < 3; k++) pal[2][k] = (uint8_t)((pal[0][k] + pal[1][k]) / 2);
        pal[2][3] = 255;
        pal[3][0] = pal[3][1] = pal[3][2] = 0;
        pal[3][3] = 0;
    }
    uint32_t bits = (uint32_t)s[4] | ((uint32_t)s[5] << 8) | ((uint32_t)s[6] << 16) | ((uint32_t)s[7] << 24);
    for (int i = 0; i < 16; i++) std::memcpy(out[i], pal[(bits >> (2 * i)) & 3], 4);
}

inline void alphaBlockBC3(const uint8_t* s, uint8_t out[16][4]) {
    uint8_t a[8];
    a[0] = s[0];
    a[1] = s[1];
    if (a[0] > a[1]) {
        for (int i = 1; i < 7; i++) a[i + 1] = (uint8_t)(((7 - i) * a[0] + i * a[1] + 3) / 7);
    } else {
        for (int i = 1; i < 5; i++) a[i + 1] = (uint8_t)(((5 - i) * a[0] + i * a[1] + 2) / 5);
        a[6] = 0;
        a[7] = 255;
    }
    uint64_t bits = 0;
    for (int i = 0; i < 6; i++) bits |= (uint64_t)s[2 + i] << (8 * i);
    for (int i = 0; i < 16; i++) out[i][3] = a[(bits >> (3 * i)) & 7];
}

inline void alphaBlockBC2(const uint8_t* s, uint8_t out[16][4]) {
    for (int i = 0; i < 16; i++) {
        int v        = (s[i / 2] >> ((i & 1) * 4)) & 15;
        out[i][3] = (uint8_t)(v * 17);
    }
}

// 解一张 mip；数据不够时剩下的块填透明（坏数据不越界）
inline std::vector<uint8_t> decode(int kind, const uint8_t* src, std::size_t srcSize, int w, int h) {
    std::vector<uint8_t> dst((std::size_t)w * h * 4, 0);
    const std::size_t    bb = blockBytes(kind);
    const int            bw = (w + 3) / 4, bh = (h + 3) / 4;
    uint8_t              px[16][4];
    for (int by = 0; by < bh; by++) {
        for (int bx = 0; bx < bw; bx++) {
            std::size_t off = ((std::size_t)by * bw + bx) * bb;
            if (off + bb > srcSize) return dst;
            const uint8_t* b = src + off;
            if (kind == 1) {
                colorBlock(b, px, true);
            } else {
                colorBlock(b + 8, px, false);
                if (kind == 2) alphaBlockBC2(b, px); else alphaBlockBC3(b, px);
            }
            for (int y = 0; y < 4; y++) {
                int yy = by * 4 + y;
                if (yy >= h) break;
                for (int x = 0; x < 4; x++) {
                    int xx = bx * 4 + x;
                    if (xx >= w) break;
                    std::memcpy(&dst[((std::size_t)yy * w + xx) * 4], px[y * 4 + x], 4);
                }
            }
        }
    }
    return dst;
}
} // namespace yd_bc
