// 云朵天气 · WE 基础素材替身：common_perspective.h —— 四边形透视映射（squareToQuad：单位正方形 → 任意四边形的投影矩阵）
#ifndef YD_COMMON_PERSPECTIVE_H
#define YD_COMMON_PERSPECTIVE_H
mat3 squareToQuad(vec2 p0, vec2 p1, vec2 p2, vec2 p3) {
	float dx1 = p1.x - p2.x, dy1 = p1.y - p2.y;
	float dx2 = p3.x - p2.x, dy2 = p3.y - p2.y;
	float sx = p0.x - p1.x + p2.x - p3.x;
	float sy = p0.y - p1.y + p2.y - p3.y;
	float den = dx1 * dy2 - dx2 * dy1;
	float g = (sx * dy2 - dx2 * sy) / den;
	float h = (dx1 * sy - sx * dy1) / den;
	float a = p1.x - p0.x + g * p1.x;
	float b = p3.x - p0.x + h * p3.x;
	float c = p0.x;
	float d = p1.y - p0.y + g * p1.y;
	float e = p3.y - p0.y + h * p3.y;
	float f = p0.y;
	// 行向量写法（配合 mul(vec3, m)）：x' = a*u + b*v + c ...
	return mat3(a, d, g,
	            b, e, h,
	            c, f, 1.0);
}
#endif
