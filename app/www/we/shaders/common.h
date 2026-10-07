// 云朵天气 · WE 基础素材替身：common.h（自写，按 WE 着色器里实际用到的函数名 / 常量补齐，不是 WE 原文件）
#ifndef YD_COMMON_H
#define YD_COMMON_H

#define M_PI 3.14159265359
#define M_PI_HALF 1.57079632679
#define M_PI_2 6.28318530718
#define SQRT_2 1.41421356237
#define SQRT_3 1.73205080756

vec2 rotateVec2(vec2 v, float r) {
	vec2 cs = vec2(cos(r), sin(r));
	return vec2(v.x * cs.x - v.y * cs.y, v.x * cs.y + v.y * cs.x);
}
float greyscale(vec3 color) { return dot(color, vec3(0.11, 0.59, 0.3)); }

vec3 rgb2hsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	float e = 1.0e-10;
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
	// 写成不带 .xxx 混写的形式：渲染器的 HLSL 修补规则会把 K.xxx 改成 K.xxxx
	vec3 p = abs(fract(vec3(c.x) + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - vec3(3.0));
	return c.z * mix(vec3(1.0), clamp(p - vec3(1.0), 0.0, 1.0), c.y);
}

// 2D 法线贴图解码（WE 的法线贴图常用 RG 两个通道）
vec3 DecompressNormal(vec4 n) {
	vec3 r = vec3(n.xy * 2.0 - 1.0, 0.0);
	r.z = sqrt(max(0.0, 1.0 - dot(r.xy, r.xy)));
	return r;
}

mat3 rotationMatrixXYZ(vec3 r) {
	vec3 s = sin(r), c = cos(r);
	mat3 rx = mat3(1.0, 0.0, 0.0,  0.0, c.x, s.x,  0.0, -s.x, c.x);
	mat3 ry = mat3(c.y, 0.0, -s.y,  0.0, 1.0, 0.0,  s.y, 0.0, c.y);
	mat3 rz = mat3(c.z, s.z, 0.0,  -s.z, c.z, 0.0,  0.0, 0.0, 1.0);
	return rz * ry * rx;
}

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

#endif
