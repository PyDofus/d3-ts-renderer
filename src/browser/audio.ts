import type { SoundEvent } from '../data/audio';
import { getLoader } from '../data/loader';
import type { DofusSprite } from '../renderer/dofusSprite';

/**
 * Schedule sprite sound events through Web Audio.
 */
export class SpriteAudioPlayer {
    private readonly _ctx: AudioContext;
    private readonly _cache = new Map<string, Promise<AudioBuffer>>();
    private _sources: AudioBufferSourceNode[] = [];
    private _lastEvents: SoundEvent[] = [];
    private _lastBuffers: (AudioBuffer | undefined)[] = [];

    constructor(ctx?: AudioContext) {
        this._ctx = ctx ?? new AudioContext();
    }

    get context(): AudioContext {
        return this._ctx;
    }

    stop(): void {
        for (const src of this._sources) try { src.stop(); } catch {}
        this._sources = [];
    }

    async playEvents(events: SoundEvent[]): Promise<void> {
        this.stop();
        this._lastEvents = events;
        this._lastBuffers = [];
        if (events.length === 0) return;
        if (this._ctx.state === 'suspended') await this._ctx.resume();

        const buffers = await this.resolveBuffers(events);
        this._lastBuffers = buffers;
        this._schedule(events, buffers);
    }

    async playForSprite(sprite: DofusSprite): Promise<void> {
        const events = await sprite.currentSoundEvents();
        await this.playEvents(events);
    }

    /** Decode (or reuse cached) AudioBuffers for the given events. */
    async resolveBuffers(events: ReadonlyArray<SoundEvent>): Promise<(AudioBuffer | undefined)[]> {
        return Promise.all(events.map(e => this._loadBuffer(e.soundPath).catch(() => undefined)));
    }

    async replay(): Promise<void> {
        if (this._lastEvents.length === 0) return;
        this.stop();
        if (this._ctx.state === 'suspended') await this._ctx.resume();
        this._schedule(this._lastEvents, this._lastBuffers);
    }

    private _schedule(events: SoundEvent[], buffers: ReadonlyArray<AudioBuffer | undefined>): void {
        const startAt = this._ctx.currentTime;
        for (let i = 0; i < events.length; i++) {
            const buf = buffers[i];
            if (!buf) continue;
            const src = this._ctx.createBufferSource();
            src.buffer = buf;
            src.connect(this._ctx.destination);
            src.start(startAt + Math.max(0, events[i]!.startTime));
            this._sources.push(src);
        }
    }

    private async _loadBuffer(soundPath: string): Promise<AudioBuffer> {
        let pending = this._cache.get(soundPath);
        if (!pending) {
            pending = (async () => this._ctx.decodeAudioData(await getLoader().audioBytes(soundPath)))();
            this._cache.set(soundPath, pending);
        }
        return pending;
    }
}
