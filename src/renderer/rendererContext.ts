import {BlendMode} from '../readers/renderState';
import {type Mat3} from '../math';
import {MASK_FRAG, MASK_VERT, RENDER_FRAG, RENDER_VERT} from './shaders';

const enum FlashBlendKeyword {
    NONE = 0,
    MULTIPLY = 1,
    SCREEN = 2,
    INVERT = 3,
}

type BlendParams = [srcRgb: number, dstRgb: number, srcA: number, dstA: number, eqRgb: number, eqA: number];

/**
 * Owns the WebGL2 context and all gl.* state.
 */
export class RendererContext {
    readonly gl: WebGL2RenderingContext;
    readonly program: WebGLProgram;
    readonly maskProgram: WebGLProgram;

    size: [number, number] = [1, 1];
    offset: [number, number] = [0, 0];

    private _textures: WebGLTexture[] = [];
    private _uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation>>();
    private _currentProgram: WebGLProgram | null = null;

    // Shared streaming buffers reused across every draw. Attribute pointers and
    // the element-array binding are baked into the VAO once; each draw just
    // re-uploads vertex + index data.
    private _vao: WebGLVertexArrayObject | null = null;
    private _vbo: WebGLBuffer | null = null;

    constructor(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', {
            stencil: true,
            alpha: true,
            premultipliedAlpha: false,
        });
        // TODO: Identify which device generations lack WebGL2 support to assess whether WebGL1 support is necessary.
        //  If so, implement a WebGL1 fallback (or alternative).
        if (!gl) throw new Error('WebGL2 is not supported in this browser.');
        this.gl = gl;
        this.program = this._createProgram(RENDER_VERT, RENDER_FRAG);
        this.maskProgram = this._createProgram(MASK_VERT, MASK_FRAG);
        gl.enable(gl.BLEND);
    }

    // ── blend modes ──────────────────────────────────────────────────────────────

    /** Maps BlendMode enum values to [srcRgb, dstRgb, srcA, dstA, eqRgb, eqA]. */
    private static readonly BLEND_MODES: Readonly<Record<number, BlendParams>> = (() => {
        const {FUNC_ADD: ADD, FUNC_REVERSE_SUBTRACT: RSUB, MAX, MIN} = WebGL2RenderingContext;
        const {
            SRC_ALPHA: SA,
            ONE_MINUS_SRC_ALPHA: OMSA,
            ONE_MINUS_DST_ALPHA: OMDA,
            ONE,
            ZERO,
            DST_COLOR,
            ONE_MINUS_SRC_COLOR: OMSC,
            ONE_MINUS_DST_COLOR: OMDC
        } = WebGL2RenderingContext;
        return {
            [BlendMode.Normal]: [SA, OMSA, OMDA, ONE, ADD, ADD],
            [BlendMode.Normal_Alternative]: [SA, OMSA, OMDA, ONE, ADD, ADD],
            [BlendMode.Layer]: [SA, OMSA, OMDA, ONE, ADD, ADD],
            [BlendMode.Alpha]: [SA, OMSA, OMDA, ONE, ADD, ADD],
            [BlendMode.Multiply]: [DST_COLOR, ZERO, OMDA, ONE, ADD, ADD],
            [BlendMode.Screen]: [ONE, OMSC, OMDA, ONE, ADD, ADD],
            [BlendMode.Lighten]: [ONE, ONE, OMDA, ONE, MAX, MAX],
            [BlendMode.Darken]: [ONE, ONE, OMDA, ONE, MIN, MIN],
            [BlendMode.Add]: [SA, ONE, OMDA, ONE, ADD, ADD],
            [BlendMode.Subtract]: [ONE, ONE, OMDA, ONE, RSUB, RSUB],
            [BlendMode.Invert]: [OMDC, OMSA, OMDA, ONE, ADD, ADD],
            [BlendMode.Erase]: [ZERO, OMSA, OMDA, ONE, ADD, ADD],
            [BlendMode.PreMultiplied]: [ONE, OMSA, OMDA, ONE, ADD, ADD],
        };
    })();

    private static readonly BLEND_KEYWORD: Readonly<Record<number, FlashBlendKeyword>> = {
        [BlendMode.Invert]: FlashBlendKeyword.INVERT,
        [BlendMode.Multiply]: FlashBlendKeyword.MULTIPLY,
        [BlendMode.Darken]: FlashBlendKeyword.MULTIPLY,
        [BlendMode.Screen]: FlashBlendKeyword.SCREEN,
        [BlendMode.Lighten]: FlashBlendKeyword.SCREEN,
        [BlendMode.Subtract]: FlashBlendKeyword.SCREEN,
    };

    private static readonly fallbackBlend = new Set<number>([BlendMode.Layer, BlendMode.Difference, BlendMode.Alpha, BlendMode.Erase, BlendMode.Overlay, BlendMode.Hardlight]);


    useProgram(program: WebGLProgram): void {
        if (this._currentProgram !== program) {
            this.gl.useProgram(program);
            this._currentProgram = program;
        }
    }

    setupBlendMode(blendMode: number): void {
        const compatibleBLendMode = this.compatibleBlendMode(blendMode)
        const params = RendererContext.BLEND_MODES[compatibleBLendMode];
        if (!params) throw new Error(`Unsupported blend mode: ${blendMode}`);
        const gl = this.gl;
        this.useProgram(this.program);
        gl.blendFuncSeparate(params[0], params[1], params[2], params[3]);
        gl.blendEquationSeparate(params[4], params[5]);
        this._setUniform1i('FLASH_BLEND', RendererContext.BLEND_KEYWORD[compatibleBLendMode] ?? FlashBlendKeyword.NONE);
    }

    private compatibleBlendMode(blendMode: number): number {
        return RendererContext.fallbackBlend.has(blendMode) ? 5 : blendMode;
    }

    // ── textures ─────────────────────────────────────────────────────────────────

    loadTexture(image: ImageBitmap, index?: number): number {
        const gl = this.gl;
        const tex = gl.createTexture();
        if (!tex) throw new Error('Failed to create WebGL texture.');
        const slot = index !== undefined ? index : this._textures.length;
        gl.activeTexture(gl.TEXTURE0 + slot);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        if (index !== undefined && index < this._textures.length) {
            const old = this._textures[index];
            if (old) gl.deleteTexture(old);
            this._textures[index] = tex;
        } else {
            this._textures.push(tex);
        }
        return slot;
    }

    unloadAllTextures(): void {
        for (const tex of this._textures) this.gl.deleteTexture(tex);
        this._textures = [];
    }

    get textureCount(): number {
        return this._textures.length;
    }

    // ── bounds / size ─────────────────────────────────────────────────────────────

    setBound(width: number, height: number, offsetX: number, offsetY: number, scale: number): void {
        const gl = this.gl;
        const w = Math.ceil(width * scale);
        const h = Math.ceil(height * scale);
        this.size = [w, h];
        this.offset = [offsetX * scale, offsetY * scale];

        gl.canvas.width = w;
        gl.canvas.height = h;
        gl.viewport(0, 0, w, h);

        this.useProgram(this.program);
        this._setUniform2f('size_factor', 2 / width, 2 / height);
        this._setUniform2f('offset', offsetX, offsetY);
        // also set for mask program
        this.useProgram(this.maskProgram);
        this._setUniformForProgram(this.maskProgram, 'size_factor_m', loc => gl.uniform2f(loc, 2 / width, 2 / height));
        this._setUniformForProgram(this.maskProgram, 'offset_m', loc => gl.uniform2f(loc, offsetX, offsetY));
    }

    // ── per-draw uniforms ─────────────────────────────────────────────────────────

    setRenderUniforms(multiplicativeColor: readonly [number, number, number, number], additiveColor: readonly [number, number, number, number], customColor: Float32Array, colorMatrix: Float32Array | null): void {
        const gl = this.gl;
        this.useProgram(this.program);
        gl.uniform4fv(this._uniform('multiplicative_color'), multiplicativeColor);
        gl.uniform4fv(this._uniform('additive_color'), additiveColor);
        gl.uniform3fv(this._uniform('custom_color'), customColor);

        if (colorMatrix) {
            this._setUniform1i('FLASH_FILTER_COLOR_MATRIX', 1);
            gl.uniform4fv(this._uniform('_ColorMatrix'), colorMatrix);
        } else {
            this._setUniform1i('FLASH_FILTER_COLOR_MATRIX', 0);
        }
    }

    setRenderUniformsPerVertex(texture: number, transfo: Mat3): void {
        const gl = this.gl;
        this.useProgram(this.program);
        this._setUniform1i('Texture', texture);
        gl.uniformMatrix3fv(this._uniform('transfo'), true, transfo);
    }

    setMaskTransfo(transfo: Mat3, texture: number): void {
        const gl = this.gl;
        this.useProgram(this.maskProgram);
        gl.uniformMatrix3fv(this._uniformForProgram(this.maskProgram, 'transfo_m'), true, transfo);
        gl.uniform1i(this._uniformForProgram(this.maskProgram, 'Texture_m'), texture);
    }

    // ── draw call helpers ─────────────────────────────────────────────────────────

    /**
     * Upload vertex + index data into the shared streaming buffers, then draw.
     * Attribute locations are fixed via layout(location = N) in the shaders, so a
     * single VAO works for both render and mask programs.
     *
     * Vertex layout (stride 20 bytes):
     *   offset 0:  in_pos       (loc 0, 2 × f32)
     *   offset 8:  in_uv        (loc 1, 2 × f32)
     *   offset 16: in_color_idx (loc 2, 1 × u32) — uses vertexAttribIPointer
     */
    drawIndexed(vertexData: ArrayBuffer, indexData: Uint32Array): void {
        const gl = this.gl;
        if (!this._vao) this._initSharedBuffers();

        gl.bindVertexArray(this._vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STREAM_DRAW);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STREAM_DRAW);
        gl.drawElements(gl.TRIANGLES, indexData.length, gl.UNSIGNED_INT, 0);
    }

    private _initSharedBuffers(): void {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        const vbo = gl.createBuffer();
        const ibo = gl.createBuffer();
        if (!vao || !vbo || !ibo) throw new Error('Failed to allocate GL buffers.');

        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 8);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribIPointer(2, 1, gl.UNSIGNED_INT, 20, 16);

        // ELEMENT_ARRAY_BUFFER binding is recorded into the VAO.
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

        this._vao = vao;
        this._vbo = vbo;
    }

    clear(): void {
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.STENCIL_BUFFER_BIT);
    }

    // ── private helpers ───────────────────────────────────────────────────────────

    private _uniform(name: string): WebGLUniformLocation {
        return this._uniformForProgram(this.program, name);
    }

    private _uniformForProgram(prog: WebGLProgram, name: string): WebGLUniformLocation {
        let progCache = this._uniformCache.get(prog);
        if (!progCache) {
            progCache = new Map();
            this._uniformCache.set(prog, progCache);
        }
        let loc = progCache.get(name);
        if (!loc) {
            const l = this.gl.getUniformLocation(prog, name);
            if (!l) throw new Error(`Uniform '${name}' not found in shader.`);
            loc = l;
            progCache.set(name, loc);
        }
        return loc;
    }

    private _setUniform1i(name: string, value: number): void {
        this.gl.uniform1i(this._uniform(name), value);
    }

    private _setUniform2f(name: string, x: number, y: number): void {
        this.gl.uniform2f(this._uniform(name), x, y);
    }

    private _setUniformForProgram(prog: WebGLProgram, name: string, fn: (loc: WebGLUniformLocation) => void): void {
        try {
            fn(this._uniformForProgram(prog, name));
        } catch { /* uniform may not exist in this program */
        }
    }

    private _createProgram(vert: string, frag: string): WebGLProgram {
        const gl = this.gl;
        const vs = this._createShader(gl.VERTEX_SHADER, vert);
        const fs = this._createShader(gl.FRAGMENT_SHADER, frag);
        const prog = gl.createProgram();
        if (!prog) throw new Error('Failed to create WebGL program.');
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error(`Program link error: ${gl.getProgramInfoLog(prog)}`);
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return prog;
    }

    private _createShader(type: number, source: string): WebGLShader {
        const gl = this.gl;
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Failed to create shader.');
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}\n---\n${source}`);
        }
        return shader;
    }
}
