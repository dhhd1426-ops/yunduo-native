// 云朵天气 · WE 基础素材替身：genericparticle
// [COMBO] {"material":"ui_editor_properties_refract","combo":"REFRACT","type":"options","default":0}

varying vec4 v_TexCoord;
varying vec4 v_Color;
#if SPRITESHEET
varying float v_FrameBlend;
#endif
#if REFRACT
varying vec3 v_ScreenCoord;
#endif

uniform sampler2D g_Texture0; // {"material":"albedo","label":"ui_editor_properties_albedo","default":"particle/halo"}
uniform float g_Overbright; // {"material":"ui_editor_properties_overbright","label":"ui_editor_properties_overbright","default":1.0,"range":[0,5]}
#if REFRACT
uniform sampler2D g_Texture1; // {"material":"normal","label":"ui_editor_properties_normal","default":"util/flatnormal"}
uniform sampler2D g_Texture2; // {"default":"_rt_FullFrameBuffer","hidden":true}
uniform float g_RefractAmount; // {"material":"ui_editor_properties_refract_amount","label":"ui_editor_properties_refract_amount","default":0.05,"range":[-1,1]}
#endif

void main() {
	vec4 albedo = texSample2D(g_Texture0, v_TexCoord.xy);
#if SPRITESHEET && SPRITESHEETBLEND
	albedo = mix(albedo, texSample2D(g_Texture0, v_TexCoord.zw), v_FrameBlend);
#endif
	vec4 color = albedo * v_Color;
	color.rgb *= g_Overbright;
#if REFRACT
	vec2 n = texSample2D(g_Texture1, v_TexCoord.xy).xy * 2.0 - 1.0;
	vec2 sc = v_ScreenCoord.xy / v_ScreenCoord.z * 0.5 + 0.5;
	vec3 behind = texSample2D(g_Texture2, sc + n * g_RefractAmount * albedo.a).rgb;
	color.rgb = mix(behind, color.rgb, 0.35);
#endif
	gl_FragColor = color;
}
