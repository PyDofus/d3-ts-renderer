import type { DofusSprite } from '../renderer/dofusSprite';
import { SpriteAudioPlayer } from './audio';


export async function saveToPng(canvas: HTMLCanvasElement, filename = 'frame.png'): Promise<Blob> {
    const blob = await encodeCurrentFrame(canvas, 'image/png');
    if (filename) downloadBlob(blob, filename);
    return blob;
}

export interface SaveWebpBrowserOptions {
    animName: string;
    scale?: number;
    computeBounds?: boolean;
    flip?: boolean;
    forcedSize?: number;
    filename?: string;
    /** 0..1, passed to canvas.toBlob. Defaults to 0.9. */
    quality?: number;
    /** Loop count for animated WebP (0 = infinite). Defaults to 0. */
    loop?: number;
    /** Max concurrent frame encodes. Defaults to 4. */
    concurrency?: number;
}

/**
 * Record a sprite animation into an animated WebP Blob.
 *
 * Each frame is snapshotted from WebGL, handed to an OffscreenCanvas for WebP
 * encoding in parallel, then muxed into an animated WebP.
 */
export async function saveToWebp(sprite: DofusSprite, options: SaveWebpBrowserOptions): Promise<Blob> {
    const { animName, scale = 1, computeBounds = true, flip = false, forcedSize, filename, quality = 0.9, loop = 0, concurrency = 4 } = options;

    const frameCount = await sprite.prepareAnimation(animName, scale, computeBounds, flip, forcedSize);
    if (frameCount === 0) throw new Error(`Animation '${animName}' has no frames`);

    const canvas = sprite.openGl.gl.canvas as HTMLCanvasElement;
    const gl = getGl(canvas);
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    const frameDurMs = Math.max(1, Math.round(1000 / sprite.data.defaultFrameRate));
    const rowBytes = width * 4;

    const rawFrames: Uint8ClampedArray[] = [];
    for (let i = 0; i < frameCount; i++) {
        sprite.renderFrame(i);
        const pixels = new Uint8ClampedArray(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        flipYInPlace(pixels, width, height);
        rawFrames.push(pixels);
    }

    // Encode each frame to WebP in parallel, rotating across a small pool of canvases.
    const pool = createEncoderPool(Math.min(concurrency, rawFrames.length), width, height);
    const frameBlobs: Blob[] = new Array(rawFrames.length);
    let next = 0;
    const workers = pool.map(async ctx => {
        while (true) {
            const i = next++;
            if (i >= rawFrames.length) return;
            frameBlobs[i] = await encodeFrameWebp(ctx, rawFrames[i]!, quality);
        }
    });
    await Promise.all(workers);

    // Parse each per-frame WebP and mux into an animated WebP.
    const parsedFrames = await Promise.all(frameBlobs.map(b => parseWebp(b)));
    const blob = muxAnimatedWebp(parsedFrames, width, height, frameDurMs, loop);

    if (filename) downloadBlob(blob, filename);
    return blob;
}


export interface SaveWebmBrowserOptions {
    animName: string;
    scale?: number;
    computeBounds?: boolean;
    flip?: boolean;
    forcedSize?: number;
    filename?: string;
    /** Mix sprite sound events into the recording. Defaults to true. */
    audio?: boolean;
    /** Reuse an existing SpriteAudioPlayer to share its decoded buffer cache. */
    audioPlayer?: SpriteAudioPlayer;
    /** Optional video bitrate hint passed to MediaRecorder. */
    videoBitsPerSecond?: number;
}

const WEBM_MIME_CANDIDATES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
];

/**
 * Record a sprite animation (plus its sound events) into a WebM Blob via MediaRecorder.
 */
export async function saveToWebm(sprite: DofusSprite, options: SaveWebmBrowserOptions): Promise<Blob> {
    const { animName, scale = 1, computeBounds = true, flip = false, forcedSize, filename, audio = true, audioPlayer, videoBitsPerSecond } = options;

    const frameCount = await sprite.prepareAnimation(animName, scale, computeBounds, flip, forcedSize);
    if (frameCount === 0) throw new Error(`Animation '${animName}' has no frames`);

    const canvas = sprite.openGl.gl.canvas as HTMLCanvasElement;
    const captureStream = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream;
    if (typeof captureStream !== 'function') throw new Error('HTMLCanvasElement.captureStream is not available');
    const stream = captureStream.call(canvas, sprite.data.defaultFrameRate);

    const events = audio ? await sprite.currentSoundEvents() : [];
    const player = events.length > 0 ? (audioPlayer ?? new SpriteAudioPlayer()) : null;
    let audioDest: MediaStreamAudioDestinationNode | null = null;
    let audioBuffers: (AudioBuffer | undefined)[] = [];
    if (player) {
        audioBuffers = await player.resolveBuffers(events);
        audioDest = player.context.createMediaStreamDestination();
        for (const track of audioDest.stream.getAudioTracks()) stream.addTrack(track);
    }

    const mimeType = pickWebmMime();
    const recorder = new MediaRecorder(stream, videoBitsPerSecond !== undefined ? { mimeType, videoBitsPerSecond } : { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });

    recorder.start();

    if (player && audioDest) {
        const ctx = player.context;
        if (ctx.state === 'suspended') await ctx.resume();
        const startAt = ctx.currentTime + 0.05;
        for (let i = 0; i < events.length; i++) {
            const buf = audioBuffers[i];
            if (!buf) continue;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(audioDest);
            src.start(startAt + Math.max(0, events[i]!.startTime));
        }
    }

    const msPerFrame = 1000 / sprite.data.defaultFrameRate;
    await new Promise<void>(resolve => {
        const startTime = performance.now();
        let i = 0;
        const tick = () => {
            sprite.renderFrame(i);
            i++;
            if (i >= frameCount) { resolve(); return; }
            const nextAt = startTime + i * msPerFrame;
            const delay = Math.max(0, nextAt - performance.now());
            setTimeout(tick, delay);
        };
        tick();
    });

    await new Promise(r => setTimeout(r, Math.max(200, msPerFrame)));
    recorder.stop();
    await stopped;

    for (const track of stream.getTracks()) track.stop();

    const blob = new Blob(chunks, { type: mimeType });
    if (filename) downloadBlob(blob, filename);
    return blob;
}


function getGl(canvas: HTMLCanvasElement): WebGLRenderingContext {
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) throw new Error('Canvas has no WebGL context');
    return gl;
}

function flipYInPlace(pixels: Uint8ClampedArray, width: number , height: number): void {
    const rowBytes = width *4;
    const tmp = new Uint8ClampedArray(rowBytes);
    for (let y = 0; y < (height >> 1); y++) {
        const top = y * rowBytes;
        const bot = (height - 1 - y) * rowBytes;
        tmp.set(pixels.subarray(top, top + rowBytes));
        pixels.copyWithin(top, bot, bot + rowBytes);
        pixels.set(tmp, bot);
    }
}

async function encodeCurrentFrame(canvas: HTMLCanvasElement, type: 'image/png' | 'image/webp', quality?: number): Promise<Blob> {
    const gl = getGl(canvas);
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    flipYInPlace(pixels, width, height);

    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const ctx2d = off.getContext('2d');
    if (!ctx2d) throw new Error('Failed to create 2D canvas context');
    ctx2d.putImageData(new ImageData(pixels, width, height), 0, 0);
    return new Promise((resolve, reject) => {
        off.toBlob(b => b ? resolve(b) : reject(new Error(`toBlob(${type}) failed`)), type, quality);
    });
}

type EncoderCtx = {
    canvas: OffscreenCanvas | HTMLCanvasElement;
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    image: ImageData;
};

function createEncoderPool(n: number, width: number, height: number): EncoderCtx[] {
    const pool: EncoderCtx[] = [];
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
    for (let i = 0; i < n; i++) {
        if (hasOffscreen) {
            const c = new OffscreenCanvas(width, height);
            const ctx = c.getContext('2d');
            if (!ctx) throw new Error('Failed to create OffscreenCanvas 2D context');
            pool.push({ canvas: c, ctx: ctx as OffscreenCanvasRenderingContext2D, image: new ImageData(width, height) });
        } else {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = height;
            const ctx = c.getContext('2d');
            if (!ctx) throw new Error('Failed to create 2D canvas context');
            pool.push({ canvas: c, ctx, image: new ImageData(width, height) });
        }
    }
    return pool;
}

async function encodeFrameWebp(enc: EncoderCtx, pixels: Uint8ClampedArray, quality: number): Promise<Blob> {
    enc.image.data.set(pixels);
    enc.ctx.putImageData(enc.image, 0, 0);
    if ('convertToBlob' in enc.canvas) {
        return (enc.canvas as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality });
    }
    return new Promise((resolve, reject) => {
        (enc.canvas as HTMLCanvasElement).toBlob(b => b ? resolve(b) : reject(new Error('toBlob(webp) failed')), 'image/webp', quality);
    });
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickWebmMime(): string {
    for (const m of WEBM_MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m;
    throw new Error('No supported WebM mime type available in this browser');
}

// ── Animated WebP muxer ──────────────────────────────────────────────────────
//
// Spec: https://developers.google.com/speed/webp/docs/riff_container
// Each input blob is a full RIFF/WEBP file; we extract its ALPH (if any) and
// VP8/VP8L chunk and pack them into ANMF frames inside a new RIFF container.

interface ParsedFrame {
    width: number;
    height: number;
    hasAlpha: boolean;
    /** Concatenated ALPH (optional) + VP8/VP8L chunk bytes, each with its 8B header + padding. */
    body: Uint8Array;
}

async function parseWebp(blob: Blob): Promise<ParsedFrame> {
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (buf.length < 12 || fourcc(buf, 0) !== 'RIFF' || fourcc(buf, 8) !== 'WEBP') {
        throw new Error('Encoder did not produce a WebP blob');
    }

    let width = 0, height = 0, hasAlpha = false;
    let alph: Uint8Array | undefined;
    let main: Uint8Array | undefined;

    let offset = 12;
    while (offset + 8 <= buf.length) {
        const tag = fourcc(buf, offset);
        const size = readU32LE(buf, offset + 4);
        const dataStart = offset + 8;
        const chunkEnd = dataStart + size + (size & 1);

        if (tag === 'VP8X') {
            hasAlpha = (buf[dataStart]! & 0x10) !== 0;
            width = 1 + readU24LE(buf, dataStart + 4);
            height = 1 + readU24LE(buf, dataStart + 7);
        } else if (tag === 'ALPH') {
            hasAlpha = true;
            alph = buf.subarray(offset, chunkEnd);
        } else if (tag === 'VP8 ') {
            if (width === 0) {
                width = readU16LE(buf, dataStart + 6) & 0x3FFF;
                height = readU16LE(buf, dataStart + 8) & 0x3FFF;
            }
            main = buf.subarray(offset, chunkEnd);
            break;
        } else if (tag === 'VP8L') {
            const b1 = buf[dataStart + 1]!;
            const b2 = buf[dataStart + 2]!;
            const b3 = buf[dataStart + 3]!;
            const b4 = buf[dataStart + 4]!;
            if (width === 0) {
                width = 1 + (b1 | ((b2 & 0x3F) << 8));
                height = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0F) << 10));
            }
            hasAlpha = hasAlpha || (b4 & 0x10) !== 0;
            main = buf.subarray(offset, chunkEnd);
            break;
        }

        offset = chunkEnd;
    }

    if (!main) throw new Error('WebP has no VP8/VP8L chunk');
    const body = alph ? concatBytes(alph, main) : main;
    return { width, height, hasAlpha, body };
}

function muxAnimatedWebp(frames: ParsedFrame[], width: number, height: number, frameDurMs: number, loop: number): Blob {
    const hasAlpha = frames.some(f => f.hasAlpha);

    const anmfChunks: Uint8Array[] = [];
    for (const f of frames) anmfChunks.push(buildAnmfChunk(f, frameDurMs));

    const vp8x = buildVp8xChunk(width, height, hasAlpha);
    const anim = buildAnimChunk(loop);

    let total = 12; // RIFF + size + WEBP
    total += vp8x.length + anim.length;
    for (const c of anmfChunks) total += c.length;

    const out = new Uint8Array(total);
    writeFourCC(out, 0, 'RIFF');
    writeU32LE(out, 4, total - 8);
    writeFourCC(out, 8, 'WEBP');
    let w = 12;
    out.set(vp8x, w); w += vp8x.length;
    out.set(anim, w); w += anim.length;
    for (const c of anmfChunks) { out.set(c, w); w += c.length; }

    return new Blob([out], { type: 'image/webp' });
}

function buildVp8xChunk(width: number, height: number, hasAlpha: boolean): Uint8Array {
    const chunk = new Uint8Array(8 + 10); // header + 10B data (even — no padding)
    writeFourCC(chunk, 0, 'VP8X');
    writeU32LE(chunk, 4, 10);
    let flags = 0x02; // animation
    if (hasAlpha) flags |= 0x10;
    chunk[8] = flags;
    writeU24LE(chunk, 12, width - 1);
    writeU24LE(chunk, 15, height - 1);
    return chunk;
}

function buildAnimChunk(loop: number): Uint8Array {
    const chunk = new Uint8Array(8 + 6); // header + 6B data (even — no padding)
    writeFourCC(chunk, 0, 'ANIM');
    writeU32LE(chunk, 4, 6);
    // background color BGRA = 0 (transparent)
    writeU16LE(chunk, 12, loop & 0xFFFF);
    return chunk;
}

function buildAnmfChunk(frame: ParsedFrame, durationMs: number): Uint8Array {
    const dataSize = 16 + frame.body.length; // 16B frame header + subchunks
    const padded = dataSize + (dataSize & 1);
    const chunk = new Uint8Array(8 + padded);
    writeFourCC(chunk, 0, 'ANMF');
    writeU32LE(chunk, 4, dataSize);
    // Frame header: x (3), y (3), w-1 (3), h-1 (3), duration (3), flags (1)
    writeU24LE(chunk, 8, 0);
    writeU24LE(chunk, 11, 0);
    writeU24LE(chunk, 14, frame.width - 1);
    writeU24LE(chunk, 17, frame.height - 1);
    writeU24LE(chunk, 20, durationMs);
    chunk[23] = 0x01; // blend = use alpha, dispose = background (clear between frames)
    chunk.set(frame.body, 24);
    return chunk;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

function fourcc(buf: Uint8Array, offset: number): string {
    return String.fromCharCode(buf[offset]!, buf[offset + 1]!, buf[offset + 2]!, buf[offset + 3]!);
}

function readU16LE(buf: Uint8Array, o: number): number {
    return buf[o]! | (buf[o + 1]! << 8);
}
function readU24LE(buf: Uint8Array, o: number): number {
    return buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16);
}
function readU32LE(buf: Uint8Array, o: number): number {
    return (buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16) | (buf[o + 3]! * 0x1000000)) >>> 0;
}

function writeFourCC(buf: Uint8Array, o: number, s: string): void {
    buf[o] = s.charCodeAt(0);
    buf[o + 1] = s.charCodeAt(1);
    buf[o + 2] = s.charCodeAt(2);
    buf[o + 3] = s.charCodeAt(3);
}
function writeU16LE(buf: Uint8Array, o: number, v: number): void {
    buf[o] = v & 0xFF;
    buf[o + 1] = (v >>> 8) & 0xFF;
}
function writeU24LE(buf: Uint8Array, o: number, v: number): void {
    buf[o] = v & 0xFF;
    buf[o + 1] = (v >>> 8) & 0xFF;
    buf[o + 2] = (v >>> 16) & 0xFF;
}
function writeU32LE(buf: Uint8Array, o: number, v: number): void {
    buf[o] = v & 0xFF;
    buf[o + 1] = (v >>> 8) & 0xFF;
    buf[o + 2] = (v >>> 16) & 0xFF;
    buf[o + 3] = (v >>> 24) & 0xFF;
}
