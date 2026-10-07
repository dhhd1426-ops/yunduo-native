// 云朵天气 · WE 基础素材替身：genericropeparticle
varying vec4 v_TexCoord;
varying vec4 v_Color;
uniform sampler2D g_Texture0; // {"material":"albedo","label":"ui_editor_properties_albedo","default":"particle/halo"}
uniform float g_Overbright; // {"material":"ui_editor_properties_overbright","label":"ui_editor_properties_overbright","default":1.0,"range":[0,5]}
void main() {
	vec4 color = texSample2D(g_Texture0, v_TexCoord.xy) * v_Color;
	color.rgb *= g_Overbright;
	gl_FragColor = color;
}
