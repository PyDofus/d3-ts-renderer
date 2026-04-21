import createGL from 'gl';
import sharp from 'sharp';
import type { ImageDecoder } from './data/loader';

export const decodeImage: ImageDecoder = async (bytes) => {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
};

export function createCanvas(width = 1, height = 1): HTMLCanvasElement {
    const gl = createGL(width, height, { stencil: true, alpha: true, premultipliedAlpha: false });
    const resizeExt = gl.getExtension('STACKGL_resize_drawingbuffer');
    if (!resizeExt) throw new Error('STACKGL_resize_drawingbuffer extension unavailable');

    const canvas = {
        _w: width,
        _h: height,
        // @ts-ignore
        get width() { return this._w; },
        // @ts-ignore
        set width(v: number) { this._w = v; resizeExt.resize(v, this._h); },
        // @ts-ignore
        get height() { return this._h; },
        // @ts-ignore
        set height(v: number) { this._h = v; resizeExt.resize(this._w, v); },
        getContext(type: string) { return type === 'webgl' ? gl : null; },
    } as unknown as HTMLCanvasElement;
    Object.defineProperty(gl, 'canvas', { value: canvas, configurable: true });
    return canvas;
}

export async function saveToPng(canvas: HTMLCanvasElement, path: string): Promise<void> {
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) throw new Error('Canvas has no WebGL context');
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = Buffer.alloc(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    await sharp(pixels, { raw: { width, height, channels: 4 } }).png().flip().toFile(path);
}
