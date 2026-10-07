// 云朵天气 · WE 基础素材替身：common_composite.h —— 模糊等特效最后一步怎么和原画面合
// COMPOSITE：0 正常 / 1 混合（按 BLENDMODE）/ 2 垫在下面 / 3 镂空；COMPOSITEMONO = 转黑白
#ifndef YD_COMMON_COMPOSITE_H
#define YD_COMMON_COMPOSITE_H
#include "common_blending.h"
#ifndef COMPOSITE
#define COMPOSITE 0
#endif
#ifndef COMPOSITEMONO
#define COMPOSITEMONO 0
#endif
#ifndef BLENDMODE
#define BLENDMODE 0
#endif
vec2 ApplyCompositeOffset(vec2 ydCoord, vec2 ydRes) { return ydCoord; }
vec4 ApplyComposite(vec4 ydBase, vec4 ydTop) {
#if COMPOSITEMONO
	ydTop.rgb = vec3(dot(ydTop.rgb, vec3(0.299, 0.587, 0.114)));
#endif
#if COMPOSITE == 1
	return vec4(ApplyBlending(BLENDMODE, ydBase.rgb, ydTop.rgb, ydTop.a), ydBase.a);
#elif COMPOSITE == 2
	return vec4(mix(ydTop.rgb, ydBase.rgb, ydBase.a), max(ydBase.a, ydTop.a));
#elif COMPOSITE == 3
	return vec4(ydTop.rgb, ydTop.a * ydBase.a);
#else
	return ydTop;
#endif
}
#endif
