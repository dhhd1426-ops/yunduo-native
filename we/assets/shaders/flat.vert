// 云朵天气 · WE 基础素材替身：flat（纯色层）
uniform mat4 g_ModelViewProjectionMatrix;
attribute vec3 a_Position;
void main() {
	gl_Position = mul(vec4(a_Position, 1.0), g_ModelViewProjectionMatrix);
}
