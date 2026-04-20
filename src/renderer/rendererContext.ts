import {BlendMode} from '../readers/renderState';
import {type Mat3} from '../math';
import type {TextureSource} from '../data/types';
import {MASK_FRAG, MASK_VERT, RENDER_FRAG, RENDER_VERT} from './shaders';

const enum FlashBlendKeyword {
    NONE = 0,
    MULTIPLY = 1,
    SCREEN = 2,
    INVERT = 3,
}

type BlendParams = [srcRgb: number, dstRgb: number, srcA: number, dstA: number, eqRgb: number, eqA: number];

const ATTR_LOC_POS = 0;
const ATTR_LOC_UV = 1;

type VAO = WebGLVertexArrayObject | WebGLVertexArrayObjectOES;

/**
 * Capability-scoped wrapper around a GL context.
 * WebGL2 has VAO / u32 indices /min-max blend natively;
 * WebGL1 probes the matching extensions and falls back when they're absent.
 */
abstract class GLBackend {
    abstract readonly gl: WebGLRenderingContext | WebGL2RenderingContext;
    abstract readonly hasVAO: boolean;
    abstract readonly supportsU32Indices: boolean;
    abstract readonly indexType: number;
    abstract readonly blendModes: Readonly<Record<number, BlendParams>>;
    /** WebGL1 forbids uniformMatrix*fv(transpose=true); WebGL2 allows it. */
    abstract readonly supportsMatTranspose: boolean;

    abstract createVAO(): VAO | null;
    abstract bindVAO(v: VAO | null): void;

    protected static _buildBlendModes(gl: WebGLRenderingContext, MIN: number, MAX: number): Readonly<Record<number, BlendParams>> {
        const ADD = gl.FUNC_ADD;
        const RSUB = gl.FUNC_REVERSE_SUBTRACT;
        const SA = gl.SRC_ALPHA;
        const OMSA = gl.ONE_MINUS_SRC_ALPHA;
        const OMDA = gl.ONE_MINUS_DST_ALPHA;
        const ONE = gl.ONE;
        const ZERO = gl.ZERO;
        const DST_COLOR = gl.DST_COLOR;
        const OMSC = gl.ONE_MINUS_SRC_COLOR;
        const OMDC = gl.ONE_MINUS_DST_COLOR;
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
    }
}

class WebGL2Backend extends GLBackend {
    readonly gl: WebGL2RenderingContext;
    readonly hasVAO = true;
    readonly supportsU32Indices = true;
    readonly supportsMatTranspose = true;
    readonly indexType: number;
    readonly blendModes: Readonly<Record<number, BlendParams>>;

    constructor(gl: WebGL2RenderingContext) {
        super();
        this.gl = gl;
        this.indexType = gl.UNSIGNED_INT;
        this.blendModes = GLBackend._buildBlendModes(gl, gl.MIN, gl.MAX);
    }

    createVAO(): VAO | null {
        return this.gl.createVertexArray();
    }

    bindVAO(v: VAO | null): void {
        this.gl.bindVertexArray(v as WebGLVertexArrayObject | null);
    }
}

class WebGL1Backend extends GLBackend {
    readonly gl: WebGLRenderingContext;
    readonly hasVAO: boolean;
    readonly supportsU32Indices: boolean;
    readonly supportsMatTranspose = false;
    readonly indexType: number;
    readonly blendModes: Readonly<Record<number, BlendParams>>;
    private readonly _vaoExt: OES_vertex_array_object | null;

    constructor(gl: WebGLRenderingContext) {
        super();
        const vao = gl.getExtension('OES_vertex_array_object');
        const uint = gl.getExtension('OES_element_index_uint');
        const minmax = gl.getExtension('EXT_blend_minmax');
        console.log(`WebGL1 extension: vao ${!!vao}, uint ${!!uint}, minmax ${!!minmax}`)

        this.gl = gl;
        this._vaoExt = vao;
        this.hasVAO = !!vao;
        this.supportsU32Indices = !!uint;
        this.indexType = uint ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        this.blendModes = GLBackend._buildBlendModes(gl, minmax ? minmax.MIN_EXT : gl.FUNC_ADD, minmax ? minmax.MAX_EXT : gl.FUNC_ADD);
    }

    createVAO(): VAO | null {
        return this._vaoExt ? this._vaoExt.createVertexArrayOES() : null;
    }

    bindVAO(v: VAO | null): void {
        if (this._vaoExt) this._vaoExt.bindVertexArrayOES(v as WebGLVertexArrayObjectOES | null);
    }
}

/**
 * Owns the WebGL context (prefers WebGL2, falls back to WebGL1 + available
 * extensions) and all gl.* state.
 */
export class RendererContext {
    readonly gl: WebGLRenderingContext | WebGL2RenderingContext;
    readonly program: WebGLProgram;
    readonly maskProgram: WebGLProgram;

    size: [number, number] = [1, 1];
    offset: [number, number] = [0, 0];

    private _textures: WebGLTexture[] = [];
    private _uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation>>();
    private _currentProgram: WebGLProgram | null = null;

    // Shared streaming buffers reused across every draw.
    // Attribute pointers and the element-array binding are baked into the VAO once;
    // each draw just re-uploads vertex + index data.
    private _vao: VAO | null = null;
    private _vbo: WebGLBuffer | null = null;
    private _ibo: WebGLBuffer | null = null;
    private _buffersReady = false;

    private readonly _backend: GLBackend;

    constructor(canvas: HTMLCanvasElement) {
        const opts: WebGLContextAttributes = {stencil: true, alpha: true, premultipliedAlpha: false};

        const gl2 = canvas.getContext('webgl2', opts);
        if (gl2) {
            this._backend = new WebGL2Backend(gl2);
        } else {
            const gl1 = canvas.getContext('webgl', opts);
            if (!gl1) throw new Error('WebGL is not supported in this browser.');
            console.log('WebGL2 is not supported. Falling back to WebGL1');
            this._backend = new WebGL1Backend(gl1);
        }

        this.gl = this._backend.gl;
        this.program = this._createProgram(RENDER_VERT, RENDER_FRAG);
        this.maskProgram = this._createProgram(MASK_VERT, MASK_FRAG);
        this.gl.enable(this.gl.BLEND);
    }

    /** False when vertex indices must be uploaded as Uint16Array (no OES_element_index_uint in WebGL1). */
    get supportsU32Indices(): boolean {
        return this._backend.supportsU32Indices;
    }

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
        const params = this._backend.blendModes[compatibleBLendMode];
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

    loadTexture(image: TextureSource, index?: number): number {
        const gl = this.gl;
        const tex = gl.createTexture();
        if (!tex) throw new Error('Failed to create WebGL texture.');
        const slot = index !== undefined ? index : this._textures.length;
        gl.activeTexture(gl.TEXTURE0 + slot);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if ('data' in image) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.data);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        }
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
        this.useProgram(this.program);
        this._setUniform1i('Texture', texture);
        this._uploadMat3(this._uniform('transfo'), transfo);
    }

    setMaskTransfo(transfo: Mat3, texture: number): void {
        const gl = this.gl;
        this.useProgram(this.maskProgram);
        this._uploadMat3(this._uniformForProgram(this.maskProgram, 'transfo_m'), transfo);
        gl.uniform1i(this._uniformForProgram(this.maskProgram, 'Texture_m'), texture);
    }

    // WebGL2 accepts transpose=true; WebGL1 forbids it.
    // to do check possibility to build dirrectly transposed matrix or change operation to avodi transpose
    private _matScratch = new Float32Array(9);
    private _uploadMat3(loc: WebGLUniformLocation, m: Mat3): void {
        if (this._backend.supportsMatTranspose) this.gl.uniformMatrix3fv(loc, true, m);
        else {
            const s = this._matScratch;
            s[0] = m[0]!; s[1] = m[3]!; s[2] = m[6]!;
            s[3] = m[1]!; s[4] = m[4]!; s[5] = m[7]!;
            s[6] = m[2]!; s[7] = m[5]!; s[8] = m[8]!;
            this.gl.uniformMatrix3fv(loc, false, s);
        }
    }

    // ── draw call helpers ─────────────────────────────────────────────────────────

    /**
     * Upload vertex + index data into the shared streaming buffers, then draw.
     * Vertex layout (stride 20 bytes, all f32):
     *   offset 0:  in_pos (loc 0, vec3) — position.xy + color idx on .z
     *   offset 12: in_uv  (loc 1, vec2)
     */
    drawIndexed(vertexData: ArrayBuffer, indexData: Uint32Array | Uint16Array): void {
        const gl = this.gl;
        if (!this._buffersReady) this._initSharedBuffers();

        if (this._backend.hasVAO) {
            this._backend.bindVAO(this._vao);
        } else {
            // No VAO available — re-establish attribute pointers and the index
            // buffer binding every draw.
            gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
            gl.enableVertexAttribArray(ATTR_LOC_POS);
            gl.vertexAttribPointer(ATTR_LOC_POS, 3, gl.FLOAT, false, 20, 0);
            gl.enableVertexAttribArray(ATTR_LOC_UV);
            gl.vertexAttribPointer(ATTR_LOC_UV, 2, gl.FLOAT, false, 20, 12);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._ibo);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STREAM_DRAW);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STREAM_DRAW);
        gl.drawElements(gl.TRIANGLES, indexData.length, this._backend.indexType, 0);
    }

    private _initSharedBuffers(): void {
        const gl = this.gl;
        const vbo = gl.createBuffer();
        const ibo = gl.createBuffer();
        if (!vbo || !ibo) throw new Error('Failed to allocate GL buffers.');
        this._vbo = vbo;
        this._ibo = ibo;

        if (this._backend.hasVAO) {
            const vao = this._backend.createVAO();
            if (!vao) throw new Error('Failed to allocate VAO.');
            this._vao = vao;
            this._backend.bindVAO(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.enableVertexAttribArray(ATTR_LOC_POS);
            gl.vertexAttribPointer(ATTR_LOC_POS, 3, gl.FLOAT, false, 20, 0);
            gl.enableVertexAttribArray(ATTR_LOC_UV);
            gl.vertexAttribPointer(ATTR_LOC_UV, 2, gl.FLOAT, false, 20, 12);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        }
        this._buffersReady = true;
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
            // headless-gl (node) only returns a location for array uniforms when queried as `name[0]`;
            // browsers accept the bare name.
            // Try bare first, then fall back to the `[0]` form.
            const l = this.gl.getUniformLocation(prog, name) ?? this.gl.getUniformLocation(prog, `${name}[0]`);
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
        gl.bindAttribLocation(prog, ATTR_LOC_POS, 'in_pos');
        gl.bindAttribLocation(prog, ATTR_LOC_UV, 'in_uv');
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
