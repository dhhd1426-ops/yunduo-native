// 云朵天气 · WE 基础素材替身：passthrough
varying vec4 v_TexCoord;
uniform sampler2D g_Texture0; // {"hidden":true}
void main() {
	gl_FragColor = texSample2D(g_Texture0, v_TexCoord.xy);
}
