// 云朵天气 · WE 基础素材替身：composelayer
varying vec4 v_TexCoord;
varying vec3 v_ScreenCoord;
uniform sampler2D g_Texture0; // {"default":"_rt_FullFrameBuffer","hidden":true}
void main() {
	vec2 sc = v_ScreenCoord.xy / v_ScreenCoord.z * 0.5 + 0.5;
	gl_FragColor = texSample2D(g_Texture0, sc);
}
