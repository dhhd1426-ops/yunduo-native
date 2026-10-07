// 云朵天气 · WE 基础素材替身：genericropeparticle（拖尾 / 绳索粒子：每一节是一条三次贝塞尔带，4 个顶点）
// a_PositionVec4 = 起点 + 半宽；a_TexCoordVec4 = 终点 + 总节数；a_TexCoordVec4C1 = 起点控制点 + 第几节；
// 细格式：a_TexCoordVec3C2 = 终点控制点，a_TexCoordC3 = (沿长度 0/1, 横向 0/1)
// 粗格式（THICKFORMAT）：a_TexCoordVec4C2 = 终点控制点 + 终点半宽，a_TexCoordVec4C3 = 终点颜色，a_TexCoordC4 = 同 C3
// 贴图方向：u 横跨带子，v 沿着带子（从头 0 到尾 1）

uniform mat4 g_ModelViewProjectionMatrix;
uniform vec3 g_OrientationForward;
uniform vec4 g_RenderVar0; // 长度, 最大长度, UV 时间偏移, 最大节数

attribute vec4 a_PositionVec4;
attribute vec4 a_TexCoordVec4;
attribute vec4 a_TexCoordVec4C1;
#if THICKFORMAT
attribute vec4 a_TexCoordVec4C2;
attribute vec4 a_TexCoordVec4C3;
attribute vec4 a_TexCoordC4;
#else
attribute vec3 a_TexCoordVec3C2;
attribute vec4 a_TexCoordC3;
#endif
attribute vec4 a_Color;

varying vec4 v_TexCoord;
varying vec4 v_Color;

vec3 bez(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
	float s = 1.0 - t;
	return p0 * (s * s * s) + p1 * (3.0 * s * s * t) + p2 * (3.0 * s * t * t) + p3 * (t * t * t);
}

void main() {
	vec3 p0 = a_PositionVec4.xyz;
	vec3 p3 = a_TexCoordVec4.xyz;
	vec3 p1 = a_TexCoordVec4C1.xyz;
#if THICKFORMAT
	vec3 p2 = a_TexCoordVec4C2.xyz;
	vec2 c = a_TexCoordC4.xy;
	float w = mix(a_PositionVec4.w, a_TexCoordVec4C2.w, c.x);
	vec4 color = mix(a_Color, a_TexCoordVec4C3, c.x);
#else
	vec3 p2 = a_TexCoordVec3C2;
	vec2 c = a_TexCoordC3.xy;
	float w = a_PositionVec4.w;
	vec4 color = a_Color;
#endif
	vec3 pos = bez(p0, p1, p2, p3, c.x);
	vec3 dir = p3 - p0;
	if (dot(dir, dir) < 1e-8) dir = vec3(0.0, 1.0, 0.0);
	vec3 side = normalize(cross(normalize(dir), g_OrientationForward));
	pos += side * (c.y * 2.0 - 1.0) * w;
	gl_Position = mul(vec4(pos, 1.0), g_ModelViewProjectionMatrix);

	float segs = max(a_TexCoordVec4.w - 1.0, 1.0);
	v_TexCoord = vec4(c.y, (a_TexCoordVec4C1.w + c.x) / segs, 0.0, 0.0);
	v_Color = color;
}
