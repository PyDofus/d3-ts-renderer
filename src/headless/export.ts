import { spawn } from 'node:child_process';
import createGL from 'gl';
import sharp from 'sharp';
import type { ImageDecoder } from '../data/loader';
import { getLoader } from '../data/loader';
import type { DofusSprite } from '../renderer/dofusSprite';
import {FORMATS} from "./ffmpeg";
import type {ExportFormat} from "./ffmpeg"
import fs from 'node:fs/promises';
import path from 'node:path';

export * from '../index';


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
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    if (!gl) throw new Error("Canvas has no WebGL context");
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = Buffer.alloc(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(path);
}

export interface SaveAnimationOptions {
    animName: string;
    extension?: ExportFormat
    outputFolder?: string
    scale?: number;
    computeBounds?: boolean;
    flipX?: boolean;
    forcedSize?: number;
    /** Mix sprite sound events into the output when the target format supports audio. Defaults to true. */
    audio?: boolean;
}

function writeAndDrain(stream: NodeJS.WritableStream, buf: Buffer): Promise<void> {
    if (stream.write(buf)) return Promise.resolve();
    return new Promise<void>(resolve => {
        const done = () => {
            stream.off('drain', done);
            stream.off('error', done);
            stream.off('close', done);
            resolve();
        };
        stream.once('drain', done);
        stream.once('error', done);
        stream.once('close', done);
    });
}

async function collectAudioInputs(sprite: DofusSprite): Promise<Array<{ buf: Buffer; delayMs: number }>> {
    const events = await sprite.currentSoundEvents();
    if (events.length === 0) return [];
    const loader = getLoader();
    const out: Array<{ buf: Buffer; delayMs: number }> = [];
    for (const ev of events) {
        try {
            const bytes = await loader.audioBytes(ev);
            out.push({buf: Buffer.from(bytes as ArrayBuffer), delayMs: Math.max(0, Math.round(ev.startTime * 1000))});
        } catch {}
    }
    return out;
}

/**
 * Render an animation to a video/animated-image file.
 *
 * Frames are piped to ffmpeg as raw RGBA on stdin;
 * audio samples (when the container supports audio) are piped on fd 3..N and mixed with adelay+amix.
 */
export async function saveAnimation(sprite: DofusSprite, options: SaveAnimationOptions): Promise<void> {
    const extension = options.extension ?? "webp"
    if (!(extension in FORMATS)) throw new Error(`Unsupported export format: ${extension}`);
    const format = FORMATS[extension];
    const { animName, scale = 1, computeBounds = true, flipX = false, forcedSize, audio = true } = options;
    const fileName = `${animName}.${extension}`
    const output = options.outputFolder ? path.join(options.outputFolder, fileName) : fileName;
    await fs.mkdir(path.dirname(output), { recursive: true });

    const frameCount = await sprite.prepareAnimation(animName, scale, computeBounds, flipX, true, forcedSize);
    if (frameCount === 0) throw new Error(`Animation '${animName}' has no frames`);

    const canvas = sprite.openGl.gl.canvas as HTMLCanvasElement;
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) throw new Error('Canvas has no WebGL context');
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    const audioInputs = audio && format.supportsAudio ? await collectAudioInputs(sprite) : [];

    const args: string[] = [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-thread_queue_size', '1024',
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        '-s', `${width}x${height}`,
        '-framerate', String(sprite.data.defaultFrameRate),
        '-i', 'pipe:0',
    ];
    for (let i = 0; i < audioInputs.length; i++) {
        args.push('-thread_queue_size', '512', '-i', `pipe:${3 + i}`);
    }

    // H264/yuv420p needs even dims.
    const videoFilter = format.requiresEvenDims ? 'pad=ceil(iw/2)*2:ceil(ih/2)*2' : '';

    if (audioInputs.length > 0) {
        const filters: string[] = [`[0:v]${videoFilter || 'null'}[vout]`];
        for (let i = 0; i < audioInputs.length; i++) {
            const d = audioInputs[i]!.delayMs;
            filters.push(`[${i + 1}:a]adelay=${d}|${d}[a${i}]`);
        }
        const mixInputs = audioInputs.map((_, i) => `[a${i}]`).join('');
        filters.push(`${mixInputs}amix=inputs=${audioInputs.length}:duration=longest:normalize=0[aout]`);
        args.push('-filter_complex', filters.join(';'));
        args.push('-map', '[vout]', '-map', '[aout]');
        if (format.audioCodec) args.push('-c:a', format.audioCodec);
        args.push('-shortest');
    } else {
        if (videoFilter) args.push('-vf', videoFilter);
        args.push('-map', '0:v');
    }

    args.push('-c:v', format.videoCodec);
    args.push(...format.videoArgs);
    args.push(output);

    const stdio: Array<'pipe' | 'ignore'> = ['pipe', 'ignore', 'pipe'];
    for (let i = 0; i < audioInputs.length; i++) stdio.push('pipe');

    const proc = spawn('ffmpeg', args, { stdio });
    let stderr = '';
    proc.stderr!.on('data', c => { stderr += c.toString(); });

    const done = new Promise<void>((resolve, reject) => {
        proc.on('error', reject);
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg (${extension}) exited with code ${code}\n${stderr.trim()}`));
        });
    });

    const audioWrites = audioInputs.map((a, i) => new Promise<void>(resolve => {
        const s = proc.stdio[3 + i] as NodeJS.WritableStream;
        s.on('error', () => resolve());
        s.end(a.buf, () => resolve());
    }));

    const stdin = proc.stdin!;
    stdin.on('error', () => {});
    const frameSize = width * height * 4;
    try {
        for (let i = 0; i < frameCount; i++) {
            if (stdin.destroyed || stdin.writableEnded) break;
            sprite.renderFrame(i);
            const frame = Buffer.allocUnsafe(frameSize);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame);
            await writeAndDrain(stdin, frame);
        }
    } finally {
        if (!stdin.writableEnded) stdin.end();
    }
    await Promise.all([...audioWrites, done]);
}
