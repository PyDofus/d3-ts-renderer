// @formatter:off
// GLSL 1.00 ES so these shaders compile on both WebGL1 (+ required extensions)
// and WebGL2 (backwards-compatible with ES 1.00).
// language=GLSL
export const RENDER_VERT = `
precision highp float;
precision highp int;

attribute vec3 in_pos;
attribute vec2 in_uv;

varying vec2 uv;
varying vec4 process_multiplicative_color;

uniform vec4 multiplicative_color;
uniform mat3 transfo;
uniform vec3 custom_color[16];

void main() {
    vec2 scale_pos = (transfo * vec3(in_pos.xy, 1.0)).xy;
    gl_Position = vec4(scale_pos, 0.0, 1.0);
    uv = in_uv;
    int idx = int(in_pos.z + 0.5);
    process_multiplicative_color = idx != 0 ? multiplicative_color * vec4(custom_color[idx], 1.0) : multiplicative_color;
}
`;

// language=GLSL
export const RENDER_FRAG = `
precision highp float;
precision highp int;

uniform sampler2D Texture;
uniform vec4 additive_color;
uniform int FLASH_BLEND;
uniform bool FLASH_FILTER_COLOR_MATRIX;
uniform vec4 _ColorMatrix[5];

varying vec2 uv;
varying vec4 process_multiplicative_color;

void main() {
    vec4 texColor = texture2D(Texture, uv);
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

    vec4 outColor;
    if (FLASH_BLEND == 0) {
        outColor = texColor;
    } else if (FLASH_BLEND == 1) {
        // MULTIPLY keyword
        outColor.rgb = texColor.aaa * (texColor.rgb - vec3(1.0)) + vec3(1.0);
        outColor.a = texColor.a;
    } else if (FLASH_BLEND == 2) {
        // SCREEN keyword
        outColor.rgb = texColor.aaa * texColor.rgb;
        outColor.a = texColor.a;
    } else {
        // INVERT keyword (FLASH_BLEND == 3)
        outColor = texColor.aaaa;
    }
    gl_FragColor = outColor;
}
`;

/** Vertex shader shared by the stencil-write pass. */
// language=GLSL
export const MASK_VERT = `
precision highp float;

attribute vec3 in_pos;
attribute vec2 in_uv;

varying vec2 uv;

uniform mat3 transfo_m;


void main() {
  vec2 scale_pos = (transfo_m * vec3(in_pos.xy, 1.0)).xy;
  gl_Position = vec4(scale_pos, 0.0, 1.0);
  uv = in_uv;
}
`;

/**
 * Mask fragment shader: discard transparent pixels so the stencil buffer
 */
// language=GLSL
export const MASK_FRAG = `
precision highp float;

uniform sampler2D Texture_m;
varying vec2 uv;

void main() {
  if (texture2D(Texture_m, uv).a < 0.1) discard;
  gl_FragColor = vec4(0.0);
}
`;
// @formatter:on
