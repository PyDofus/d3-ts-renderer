// @formatter:off
// language=GLSL
export const RENDER_VERT = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 in_pos;
layout(location = 1) in vec2 in_uv;
layout(location = 2) in uint in_color_idx;

out vec2 uv;
out vec4 process_multiplicative_color;

uniform vec4 multiplicative_color;
uniform mat3 transfo;
uniform vec2 offset;
uniform vec2 size_factor;
uniform vec3 custom_color[16];

void main() {
    vec2 scale_pos = size_factor * ((transfo * vec3(in_pos, 1.0)).xy - offset) - 1.0;
    gl_Position = vec4(scale_pos, 0.0, 1.0);
    uv = in_uv;
    process_multiplicative_color = in_color_idx != 0u ? multiplicative_color * vec4(custom_color[in_color_idx], 1.0) : multiplicative_color;
}
`;

// language=GLSL
export const RENDER_FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D Texture;
uniform vec4 additive_color;
uniform int FLASH_BLEND;
uniform bool FLASH_FILTER_COLOR_MATRIX;
uniform vec4 _ColorMatrix[5];

in vec2 uv;
in vec4 process_multiplicative_color;

out vec4 fragColor;

void main() {
    vec4 texColor = texture(Texture, uv);
    if (texColor.a < 0.01) discard;

    texColor = texColor * process_multiplicative_color + additive_color;

    if (FLASH_FILTER_COLOR_MATRIX) {
        vec4 tmp;
        tmp.x = dot(texColor, _ColorMatrix[0]);
        tmp.y = dot(texColor, _ColorMatrix[1]);
        tmp.z = dot(texColor, _ColorMatrix[2]);
        tmp.w = dot(texColor, _ColorMatrix[3]);
        texColor = tmp + _ColorMatrix[4];
    }

    if (FLASH_BLEND == 0) {
        fragColor = texColor;
    } else if (FLASH_BLEND == 1) {
        // MULTIPLY keyword
        fragColor.rgb = texColor.aaa * (texColor.rgb - vec3(1.0)) + vec3(1.0);
        fragColor.a = texColor.a;
    } else if (FLASH_BLEND == 2) {
        // SCREEN keyword
        fragColor.rgb = texColor.aaa * texColor.rgb;
        fragColor.a = texColor.a;
    } else {
        // INVERT keyword (FLASH_BLEND == 3)
        fragColor = texColor.aaaa;
    }
}
`;

/** Vertex shader shared by the stencil-write pass. */
// language=GLSL
export const MASK_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 in_pos;
layout(location = 1) in vec2 in_uv;

out vec2 uv;

uniform mat3 transfo_m;
uniform vec2 offset_m;
uniform vec2 size_factor_m;

void main() {
  vec2 scale_pos = size_factor_m * ((transfo_m * vec3(in_pos, 1.0)).xy - offset_m) - 1.0;
  gl_Position = vec4(scale_pos, 0.0, 1.0);
  uv = in_uv;
}
`;

/**
 * Mask fragment shader: discard transparent pixels so the stencil buffer
 */
// language=GLSL
export const MASK_FRAG = `#version 300 es
precision highp float;

uniform sampler2D Texture_m;
in vec2 uv;
out vec4 fragColor;

void main() {
  if (texture(Texture_m, uv).a < 0.1) discard;
  fragColor = vec4(0.0);
}
`;
// @formatter:on
