// 云朵天气 · WE 基础素材替身：genericimage2（普通图片层；支持骨骼人偶 SKINNING 和混合模式 BLENDMODE）
// [COMBO] {"material":"ui_editor_properties_blend_mode","combo":"BLENDMODE","type":"imageblending","default":0}

uniform mat4 g_ModelViewProjectionMatrix;

#if SKINNING
uniform mat4 g_Bones[BONECOUNT];
attribute uvec4 a_BlendIndices;
attribute vec4 a_BlendWeights;
#endif

attribute vec3 a_Position;
attribute vec2 a_TexCoord;

varying vec4 v_TexCoord;
#if BLENDMODE
varying vec3 v_ScreenCoord;
#endif

void main() {
	vec3 position = a_Position;
#if SKINNING
	position = (mul(vec4(a_Position, 1.0), g_Bones[a_BlendIndices.x]) * a_BlendWeights.x +
	            mul(vec4(a_Position, 1.0), g_Bones[a_BlendIndices.y]) * a_BlendWeights.y +
	            mul(vec4(a_Position, 1.0), g_Bones[a_BlendIndices.z]) * a_BlendWeights.z +
	            mul(vec4(a_Position, 1.0), g_Bones[a_BlendIndices.w]) * a_BlendWeights.w).xyz;
#endif
	gl_Position = mul(vec4(position, 1.0), g_ModelViewProjectionMatrix);
	v_TexCoord = a_TexCoord.xyxy;
#if BLENDMODE
	v_ScreenCoord = gl_Position.xyw;
#endif
}
