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

    get isPlaying(): boolean { return this._rafId !== null; }
    get audioPlayer(): SpriteAudioPlayer | null { return this._audioPlayer; }

    async play(sprite: DofusSprite, animName: string, options: SpritePlayOptions = {}): Promise<number> {
        this.stop();

        const { scale = 1, computeBounds = true, flip = false, forcedSize, audio = true, onFrame } = options;
        const frameCount = await sprite.prepareAnimation(animName, scale, computeBounds, flip, forcedSize);
        const fps = sprite.data.defaultFrameRate;
        const msPerFrame = 1000 / fps;

        if (audio) {
            this._audioPlayer ??= new SpriteAudioPlayer();
            this._audioPlayer.playForSprite(sprite).catch(() => {});
        }

        let frameIndex = 0;
        let lastTime = 0;
        const tick = (time: number) => {
            this._rafId = requestAnimationFrame(tick);
            if (time - lastTime < msPerFrame) return;
            lastTime = time;
            if (audio && frameIndex > 0 && frameIndex % frameCount === 0) {
                this._audioPlayer?.replay().catch(() => {});
            }
            sprite.renderFrame(frameIndex);
            onFrame?.(frameIndex);
            frameIndex++;
        };
        this._rafId = requestAnimationFrame(tick);
        return frameCount;
    }

    stop(): void {
        if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        this._audioPlayer?.stop();
    }
}
