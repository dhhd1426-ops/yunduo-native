// 云朵天气 · WE 基础素材替身：genericparticle（精灵粒子，每个粒子 4 个顶点，由渲染器按 a_TexCoordVec4.xy 摆成四角）
// a_Position 粒子中心；a_TexCoordVec4 = (角 u, 角 v, 绕 z 旋转, 半边长)；a_Color = 颜色 + 透明度；
// a_TexCoordVec4C1（THICKFORMAT）= 速度 + 帧序号；a_TexCoordC2 = 绕 x / y 旋转
// [COMBO] {"material":"ui_editor_properties_refract","combo":"REFRACT","type":"options","default":0}

#include "common.h"

uniform mat4 g_ModelViewProjectionMatrix;
uniform vec3 g_OrientationUp;
uniform vec3 g_OrientationRight;
uniform vec3 g_OrientationForward;
#if SPRITESHEET
uniform vec4 g_RenderVar1;
#endif

attribute vec3 a_Position;
attribute vec4 a_TexCoordVec4;
attribute vec4 a_Color;
#if THICKFORMAT
attribute vec4 a_TexCoordVec4C1;
#endif
attribute vec2 a_TexCoordC2;

varying vec4 v_TexCoord;
varying vec4 v_Color;
#if SPRITESHEET
varying float v_FrameBlend;
#endif
#if REFRACT
varying vec3 v_ScreenCoord;
#endif

void main() {
	mat3 rot = rotationMatrixXYZ(vec3(a_TexCoordC2.x, a_TexCoordC2.y, a_TexCoordVec4.z));
	vec3 right = rot * g_OrientationRight;
	vec3 up = rot * g_OrientationUp;
	vec2 corner = a_TexCoordVec4.xy;
	float size = a_TexCoordVec4.w;
	vec3 position = a_Position + (right * (corner.x * 2.0 - 1.0) + up * (1.0 - corner.y * 2.0)) * size;
	gl_Position = mul(vec4(position, 1.0), g_ModelViewProjectionMatrix);
	v_Color = a_Color;
	v_TexCoord = corner.xyxy;
#if SPRITESHEET
	float frames = max(g_RenderVar1.z, 1.0);
	float cols = max(floor(1.0 / max(g_RenderVar1.x, 1e-4) + 0.5), 1.0);
	float f = a_TexCoordVec4C1.w * frames;
	float f0 = mod(floor(f), frames);
	float f1 = mod(f0 + 1.0, frames);
	v_FrameBlend = fract(f);
	v_TexCoord.xy = (corner + vec2(mod(f0, cols), floor(f0 / cols))) * g_RenderVar1.xy;
	v_TexCoord.zw = (corner + vec2(mod(f1, cols), floor(f1 / cols))) * g_RenderVar1.xy;
#endif
#if REFRACT
	v_ScreenCoord = gl_Position.xyw;
#endif
}
