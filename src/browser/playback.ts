import type {DofusSprite} from '../renderer/dofusSprite';
import type {Look} from '../look/look';
import {SpriteAudioPlayer} from './audio';
import {Directions} from "../data/directions";
import type {SaveWebmBrowserOptions, SaveWebpBrowserOptions} from './export';
import {saveToPng, saveToWebm, saveToWebp} from './export';

export interface SpritePlayOptions {
    animName?:string
    scale?: number;
    forcedSize?: number;
    audio?: boolean;
    direction?: Directions;
    onFrame?: (frameIndex: number) => void
    paused?: boolean;
    startFrame?: number;
}

/**
 * Drive a DofusSprite on a requestAnimationFrame loop locked to its fps,
 * with looping audio playback via a shared SpriteAudioPlayer.
 */
export class SpritePlayback {
    private _rafId: number | null = null;
    private _audioPlayer: SpriteAudioPlayer | null = null;
    private _tick: ((time: number) => void) | null = null;
    private _paused = false;
    private _generation = 0;

    private _sprite: DofusSprite | null = null;
    private _baseAnimName: string | undefined;
    private _direction: Directions = Directions.DOWN_RIGHT;
    private _scale = 1;
    private _forcedSize: number | undefined;
    private _flip = false;
    private _frameIndex = 0;
    private _resync = false;
    private _muted = false;

    get isPlaying(): boolean { return this._rafId !== null; }
    get isPaused(): boolean { return this._paused; }
    get isMuted(): boolean { return this._muted; }
    get audioPlayer(): SpriteAudioPlayer | null { return this._audioPlayer; }
    get direction(): Directions { return this._direction; }
    get sprite(): DofusSprite | null { return this._sprite; }
    get scale(): number { return this._scale; }
    get animation(): string | undefined { return this._baseAnimName; }


    private _resolveAnim(sprite: DofusSprite, options: SpritePlayOptions): [string, boolean] {
        const animName = options.animName;
        if (options.direction !== undefined || !animName) {
            return sprite.getAnimName(options.direction ?? Directions.DOWN_RIGHT, animName, false);
        }
        return [animName, false];
    }

    async play(sprite: DofusSprite, options: SpritePlayOptions = {}, resolved?: [string, boolean]): Promise<number> {
        const wasPaused = options.paused ?? this._paused;
        this.stop();
        const gen = this._generation;

        const { scale = 1, forcedSize, audio = true, onFrame, startFrame = 0 } = options;
        const startAudio = audio && !wasPaused;
        this._sprite = sprite;
        this._direction = options.direction ?? Directions.DOWN_RIGHT;
        this._scale = scale;
        this._forcedSize = forcedSize;

        const [fullName, flip] = resolved ?? this._resolveAnim(sprite, options);
        this._baseAnimName =  fullName.slice(0, fullName.lastIndexOf("_"));
        this._flip = flip;
        const frameCount = await sprite.prepareAnimation(fullName, scale, true, flip, false, forcedSize);
        if (gen !== this._generation) return frameCount;
        const fps = sprite.data.defaultFrameRate;
        const msPerFrame = 1000 / fps;

        if (startAudio) {
            this._audioPlayer ??= new SpriteAudioPlayer();
            this._audioPlayer.muted = this._muted;
            this._audioPlayer.playForSprite(sprite).catch(() => {});
        }

        let firstFrameDone = false;

        this._frameIndex = startFrame > 0 ? startFrame : 0;
        this._resync = true;
        let startTime = 0;
        const tick = (time: number) => {
            if (gen !== this._generation) return;
            this._rafId = requestAnimationFrame(tick);
            if (this._resync) {
                startTime = time - this._frameIndex * msPerFrame;
                this._resync = false;
            }
            const target = Math.floor((time - startTime) / msPerFrame);
            if (target < this._frameIndex) return;
            this._frameIndex = target;
            sprite.renderFrame(this._frameIndex);
            this._audioPlayer?.replayOnLoop(this._frameIndex).catch(() => {});
            onFrame?.(this._frameIndex);
            this._frameIndex++;
            if (!firstFrameDone) {
                firstFrameDone = true;
                if (wasPaused) this.pause();
            }
        };
        this._tick = tick;
        this._paused = false;
        this._rafId = requestAnimationFrame(tick);
        return frameCount;
    }


    async replace(factory: () => Promise<DofusSprite>, options: SpritePlayOptions = {}): Promise<DofusSprite> {
        const wasPaused = this._paused;
        this.stop();
        const sprite = await factory();
        await this.play(sprite, {...options, paused: wasPaused});
        return sprite;
    }

    /**
     * Mutate the currently playing sprite to `newLook`
     * re-fetching only what changed
     * resume playback
     */
    async replaceLook(newLook: Look, options: SpritePlayOptions & {boneName?: string} = {}): Promise<DofusSprite> {
        const sprite = this._sprite;
        if (!sprite) throw new Error('Playback is not active');
        const wasPaused = this._paused;
        const { startFrame, resolved } = this._frameToKeep(newLook, options);
        this.stop();
        await sprite.changeLook(newLook, options.boneName);
        await this.play(sprite, {...options, paused: wasPaused, startFrame}, resolved ?? undefined);
        return sprite;
    }

    /**
     * Resume from the current frame when the main animation is unchanged,
     */
    private _frameToKeep(newLook: Look, options: SpritePlayOptions & {boneName?: string}): { startFrame: number; resolved: [string, boolean] | null } {
        const none = { startFrame: 0, resolved: null };
        const sprite = this._sprite;
        if (!sprite) return none;
        if (!this.isPlaying && !this._paused) return none;
        if (newLook.bone !== sprite.look.bone) return none;
        if ((options.boneName ?? String(newLook.bone)) !== sprite.data.m_Name) return none;
        if ((options.direction ?? Directions.DOWN_RIGHT) !== this._direction) return none;
        try {
            const resolved = this._resolveAnim(sprite, options);
            const base = resolved[0].slice(0, resolved[0].lastIndexOf('_'));
            return { startFrame: base === this._baseAnimName ? this._frameIndex : 0, resolved };
        } catch {
            return none;
        }
    }

    /**
     * Render `newLook`: reuse the active sprite  when one exists, otherwise build a new one with `factory`
     */
    async renderLook(
        newLook: Look,
        factory: () => Promise<DofusSprite>,
        options: SpritePlayOptions & {boneName?: string} = {},
    ): Promise<DofusSprite> {
        return this._sprite ? this.replaceLook(newLook, options) : this.replace(factory, options);
    }

    async setDirection(direction: Directions, onFrame?: (frameIndex: number) => void): Promise<number> {
        if (!this._sprite || !this._baseAnimName) return 0;
        return this.play(this._sprite, {direction, animName: this._baseAnimName, onFrame, scale: this._scale, forcedSize: this._forcedSize});
    }

    toggle(): boolean {
        if (this._paused) this.resume();
        else this.pause();
        return this._paused;
    }

    setMuted(muted: boolean): void {
        this._muted = muted;
        if (this._audioPlayer) this._audioPlayer.muted = muted;
    }

    toggleMute(): boolean {
        this.setMuted(!this._muted);
        return this._muted;
    }


    setScale(scale: number): void {
        if (!this._sprite) return;
        this._scale = scale;
        this._sprite.resize(scale, this._forcedSize);
        this.redraw();
    }

    /**
     * Re-render the current frame in place
     */
    redraw(): void {
        if (!this._sprite?.currentRendering) return;
        const frame = this._frameIndex > 0 ? this._frameIndex - 1 : this._frameIndex;
        this._sprite.renderFrame(frame);
    }

    pause(): void {
        if (this._rafId === null || this._paused) return;
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
        this._paused = true;
        this._audioPlayer?.context.suspend().catch(() => {});
    }

    resume(): void {
        if (!this._paused || this._tick === null) return;
        this._paused = false;
        this._resync = true;
        this._audioPlayer?.context.resume().catch(() => {});
        this._rafId = requestAnimationFrame(this._tick);
    }

    stop(): void {
        this._generation++;
        if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        this._tick = null;
        this._paused = false;
        this._sprite = null;
        this._frameIndex = 0;
        this._audioPlayer?.stop();
    }

    async capturePng(filename?: string): Promise<Blob> {
        const sprite = this._sprite;
        if (!sprite) throw new Error('Playback is not active');
        const wasPlaying = this._rafId !== null;
        if (wasPlaying) this.pause();
        this.redraw();
        const promise = saveToPng(sprite.openGl.gl.canvas as HTMLCanvasElement, filename);
        if (wasPlaying) this.resume();
        return promise;
    }

    async captureWebp(filename?: string, overrides?: Partial<SaveWebpBrowserOptions>): Promise<Blob> {
        const sprite = this._sprite;
        if (!sprite || !this._baseAnimName) throw new Error('Playback is not active');
        const wasPlaying = this._rafId !== null;
        if (wasPlaying) this.pause();
        try {
            return await saveToWebp(sprite, {
                animName: `${this._baseAnimName}_${this._direction}`,
                scale: this._scale,
                forcedSize: this._forcedSize,
                flip: this._flip,
                filename,
                ...overrides,
            });
        } finally {
            if (wasPlaying) this.resume();
        }
    }

    async captureWebm(filename?: string, overrides?: Partial<SaveWebmBrowserOptions>): Promise<Blob> {
        const sprite = this._sprite;
        if (!sprite || !this._baseAnimName) throw new Error('Playback is not active');
        const wasPlaying = this._rafId !== null;
        if (wasPlaying) this.pause();
        try {
            return await saveToWebm(sprite, {
                animName: `${this._baseAnimName}_${this._direction}`,
                scale: this._scale,
                forcedSize: this._forcedSize,
                flip: this._flip,
                audioPlayer: this._audioPlayer ?? undefined,
                filename,
                ...overrides,
            });
        } finally {
            if (wasPlaying) this.resume();
        }
    }

    offset(): {x:number, y:number} {
        return this._sprite?.openGl.offset ?? {x: 0, y: 0};
    }
}
