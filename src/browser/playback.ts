import type { DofusSprite } from '../renderer/dofusSprite';
import { SpriteAudioPlayer } from './audio';

export interface SpritePlayOptions {
    scale?: number;
    computeBounds?: boolean;
    flip?: boolean;
    forcedSize?: number;
    audio?: boolean;
    onFrame?: (frameIndex: number) => void;
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

    get isPlaying(): boolean { return this._rafId !== null; }
    get isPaused(): boolean { return this._paused; }
    get audioPlayer(): SpriteAudioPlayer | null { return this._audioPlayer; }

    async play(sprite: DofusSprite, animName: string, options: SpritePlayOptions = {}): Promise<number> {
        this.stop();

        const { scale = 1, computeBounds = true, flip = false, forcedSize, audio = true, onFrame } = options;
        const frameCount = await sprite.prepareAnimation(animName, scale, computeBounds, flip, false, forcedSize);
        const fps = sprite.data.defaultFrameRate;
        const msPerFrame = 1000 / fps;

        if (audio) {
            this._audioPlayer ??= new SpriteAudioPlayer();
            this._audioPlayer.playForSprite(sprite).catch(() => {});
        }

        let frameIndex = 0;
        let lastTime = 0;
        this._tick = (time: number) => {
            this._rafId = requestAnimationFrame(this._tick!);
            if (time - lastTime < msPerFrame) return;
            lastTime = time;
            this._audioPlayer?.replayOnLoop(frameIndex).catch(() => {});
            sprite.renderFrame(frameIndex);
            onFrame?.(frameIndex);
            frameIndex++;
        };
        this._paused = false;
        this._rafId = requestAnimationFrame(this._tick);
        return frameCount;
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
        this._audioPlayer?.context.resume().catch(() => {});
        this._rafId = requestAnimationFrame(this._tick);
    }

    stop(): void {
        if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        this._tick = null;
        this._paused = false;
        this._audioPlayer?.stop();
    }
}
