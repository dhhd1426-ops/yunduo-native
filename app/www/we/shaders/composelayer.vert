// 云朵天气 · WE 基础素材替身：composelayer（合成层的底：把这一层所在位置已经画好的画面抓过来）
uniform mat4 g_ModelViewProjectionMatrix;
attribute vec3 a_Position;
attribute vec2 a_TexCoord;
varying vec4 v_TexCoord;
varying vec3 v_ScreenCoord;
void main() {
	gl_Position = mul(vec4(a_Position, 1.0), g_ModelViewProjectionMatrix);
	v_TexCoord = a_TexCoord.xyxy;
	v_ScreenCoord = gl_Position.xyw;
}
