// 云朵天气 · WE 基础素材替身：flat
uniform vec3 g_Color; // {"material":"color","label":"ui_editor_properties_color","type":"color","default":"1 1 1"}
uniform float g_Alpha; // {"material":"alpha","label":"ui_editor_properties_alpha","default":1,"range":[0,1]}
void main() {
	gl_FragColor = vec4(g_Color, g_Alpha);
}
