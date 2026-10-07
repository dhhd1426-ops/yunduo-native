// 云朵天气 · WE 基础素材替身：genericimage2
// [COMBO] {"material":"ui_editor_properties_blend_mode","combo":"BLENDMODE","type":"imageblending","default":0}

#include "common_blending.h"

varying vec4 v_TexCoord;
#if BLENDMODE
varying vec3 v_ScreenCoord;
#endif

uniform sampler2D g_Texture0; // {"material":"albedo","label":"ui_editor_properties_albedo","default":"util/white"}
#if BLENDMODE
uniform sampler2D g_Texture2; // {"default":"_rt_FullFrameBuffer","hidden":true}
#endif

uniform float g_Brightness;
uniform float g_UserAlpha;
uniform vec4 g_Color4;

void main() {
	vec4 albedo = texSample2D(g_Texture0, v_TexCoord.xy);
#if VERSION
	albedo.rgb *= g_Color4.rgb;
#endif
	albedo.rgb *= g_Brightness;
	albedo.a *= g_UserAlpha;
#if BLENDMODE
	vec2 sc = v_ScreenCoord.xy / v_ScreenCoord.z * 0.5 + 0.5;
	vec3 screen = texSample2D(g_Texture2, sc).rgb;
	albedo.rgb = ApplyBlending(BLENDMODE, screen, albedo.rgb, 1.0);
#endif
	gl_FragColor = albedo;
}
