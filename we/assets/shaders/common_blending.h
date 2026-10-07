// 云朵天气 · WE 基础素材替身：common_blending.h —— 按 WE 编辑器混合模式的编号
// 0 正常 1 变暗 2 正片叠底 3 颜色加深 4 线性加深 5 变亮 6 滤色 7 颜色减淡 8 线性减淡 9 叠加 10 柔光 11 强光 12 亮光 13 线性光
// 14 点光 15 实色混合 16 差值 17 排除 18 减去 19 反射 20 发光 21 凤凰 22 平均 23 否定 24–27 色相/饱和度/颜色/明度
#ifndef YD_COMMON_BLENDING_H
// 变量名都带 yd 前缀：渲染器修补 HLSL 写法时按变量名猜类型，单字母名会被误改（比如把 vec3 B 当成 vec2）
#define YD_COMMON_BLENDING_H
float ydLum(vec3 ydC) { return dot(ydC, vec3(0.299, 0.587, 0.114)); }
vec3 ydBurn(vec3 ydA, vec3 ydB) { return mix(max(1.0 - (1.0 - ydA) / max(ydB, vec3(1e-4)), 0.0), vec3(0.0), step(ydB, vec3(1e-4))); }
vec3 ydDodge(vec3 ydA, vec3 ydB) { return mix(min(ydA / max(1.0 - ydB, vec3(1e-4)), 1.0), vec3(1.0), step(vec3(1.0 - 1e-4), ydB)); }
vec3 ydSetLum(vec3 ydC, float ydLv) {
	vec3 ydR = ydC + (ydLv - ydLum(ydC));
	float ydL = ydLum(ydR), ydN = min(min(ydR.r, ydR.g), ydR.b), ydX = max(max(ydR.r, ydR.g), ydR.b);
	if (ydN < 0.0) ydR = ydL + (ydR - ydL) * ydL / max(ydL - ydN, 1e-4);
	if (ydX > 1.0) ydR = ydL + (ydR - ydL) * (1.0 - ydL) / max(ydX - ydL, 1e-4);
	return ydR;
}
vec3 ApplyBlending(const int mode, vec3 ydA, vec3 ydB, float ydO) {
	vec3 ydR = ydB;
	if (mode == 1) ydR = min(ydA, ydB);
	else if (mode == 2) ydR = ydA * ydB;
	else if (mode == 3) ydR = ydBurn(ydA, ydB);
	else if (mode == 4) ydR = max(ydA + ydB - 1.0, 0.0);
	else if (mode == 5) ydR = max(ydA, ydB);
	else if (mode == 6) ydR = 1.0 - (1.0 - ydA) * (1.0 - ydB);
	else if (mode == 7) ydR = ydDodge(ydA, ydB);
	else if (mode == 8) ydR = min(ydA + ydB, 1.0);
	else if (mode == 9) ydR = mix(2.0 * ydA * ydB, 1.0 - 2.0 * (1.0 - ydA) * (1.0 - ydB), step(0.5, ydA));
	else if (mode == 10) ydR = mix(2.0 * ydA * ydB + ydA * ydA * (1.0 - 2.0 * ydB), sqrt(ydA) * (2.0 * ydB - 1.0) + 2.0 * ydA * (1.0 - ydB), step(0.5, ydB));
	else if (mode == 11) ydR = mix(2.0 * ydA * ydB, 1.0 - 2.0 * (1.0 - ydA) * (1.0 - ydB), step(0.5, ydB));
	else if (mode == 12) ydR = mix(ydBurn(ydA, 2.0 * ydB), ydDodge(ydA, 2.0 * (ydB - 0.5)), step(0.5, ydB));
	else if (mode == 13) ydR = clamp(ydA + 2.0 * ydB - 1.0, 0.0, 1.0);
	else if (mode == 14) ydR = mix(min(ydA, 2.0 * ydB), max(ydA, 2.0 * (ydB - 0.5)), step(0.5, ydB));
	else if (mode == 15) ydR = step(1.0, ydA + ydB);
	else if (mode == 16) ydR = abs(ydA - ydB);
	else if (mode == 17) ydR = ydA + ydB - 2.0 * ydA * ydB;
	else if (mode == 18) ydR = max(ydA - ydB, 0.0);
	else if (mode == 19) ydR = mix(min(ydA * ydA / max(1.0 - ydB, vec3(1e-4)), 1.0), vec3(1.0), step(vec3(1.0 - 1e-4), ydB));
	else if (mode == 20) ydR = mix(min(ydB * ydB / max(1.0 - ydA, vec3(1e-4)), 1.0), vec3(1.0), step(vec3(1.0 - 1e-4), ydA));
	else if (mode == 21) ydR = min(ydA, ydB) - max(ydA, ydB) + 1.0;
	else if (mode == 22) ydR = (ydA + ydB) * 0.5;
	else if (mode == 23) ydR = 1.0 - abs(1.0 - ydA - ydB);
	else if (mode == 24 || mode == 26) ydR = ydSetLum(ydB, ydLum(ydA));
	else if (mode == 25) ydR = mix(vec3(ydLum(ydA)), ydA, clamp(length(ydB - vec3(ydLum(ydB))) * 2.0, 0.0, 1.0));
	else if (mode == 27) ydR = ydSetLum(ydA, ydLum(ydB));
	return mix(ydA, ydR, ydO);
}
#endif
