// 云朵天气 · WE 基础素材替身：common_blur.h —— 一维高斯模糊（调用方先声明 g_Texture0；dir = 每一步的 UV 偏移）
// 带 a 的版本连 alpha 一起模糊（先预乘再除回去，透明边缘不发黑）
#ifndef YD_COMMON_BLUR_H
#define YD_COMMON_BLUR_H
vec4 ydBlurTap(vec2 uv) { vec4 c = texSample2D(g_Texture0, uv); return vec4(c.rgb * c.a, c.a); }
vec4 ydBlurEnd(vec4 s) { return vec4(s.rgb / max(s.a, 1e-5), s.a); }
vec4 blur13a(vec2 uv, vec2 d) {
	// σ≈2.5 的 13 点权重（左右对称）
	const float w0 = 0.1592, w1 = 0.1473, w2 = 0.1165, w3 = 0.0789, w4 = 0.0457, w5 = 0.0227, w6 = 0.0096;
	vec4 s = ydBlurTap(uv) * w0;
	s += (ydBlurTap(uv + d) + ydBlurTap(uv - d)) * w1;
	s += (ydBlurTap(uv + d * 2.0) + ydBlurTap(uv - d * 2.0)) * w2;
	s += (ydBlurTap(uv + d * 3.0) + ydBlurTap(uv - d * 3.0)) * w3;
	s += (ydBlurTap(uv + d * 4.0) + ydBlurTap(uv - d * 4.0)) * w4;
	s += (ydBlurTap(uv + d * 5.0) + ydBlurTap(uv - d * 5.0)) * w5;
	s += (ydBlurTap(uv + d * 6.0) + ydBlurTap(uv - d * 6.0)) * w6;
	return ydBlurEnd(s / (w0 + 2.0 * (w1 + w2 + w3 + w4 + w5 + w6)));
}
vec4 blur7a(vec2 uv, vec2 d) {
	const float w0 = 0.2660, w1 = 0.2130, w2 = 0.1093, w3 = 0.0360;
	vec4 s = ydBlurTap(uv) * w0;
	s += (ydBlurTap(uv + d) + ydBlurTap(uv - d)) * w1;
	s += (ydBlurTap(uv + d * 2.0) + ydBlurTap(uv - d * 2.0)) * w2;
	s += (ydBlurTap(uv + d * 3.0) + ydBlurTap(uv - d * 3.0)) * w3;
	return ydBlurEnd(s / (w0 + 2.0 * (w1 + w2 + w3)));
}
vec4 blur3a(vec2 uv, vec2 d) {
	vec4 s = ydBlurTap(uv) * 0.5 + (ydBlurTap(uv + d) + ydBlurTap(uv - d)) * 0.25;
	return ydBlurEnd(s);
}
vec3 blur13(vec2 uv, vec2 d) { return blur13a(uv, d).rgb; }
vec3 blur7(vec2 uv, vec2 d) { return blur7a(uv, d).rgb; }
vec3 blur3(vec2 uv, vec2 d) { return blur3a(uv, d).rgb; }
#endif
