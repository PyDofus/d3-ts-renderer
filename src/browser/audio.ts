import type {SoundEvent} from '../data/audio';
import {getLoader} from '../data/loader';
import type {DofusSprite} from '../renderer/dofusSprite';

/**
 * Schedule sprite sound events through Web Audio.
 */
export class SpriteAudioPlayer {
    private readonly _ctx: AudioContext;
    private readonly _gain: GainNode;
    private readonly _cache = new Map<string, Promise<AudioBuffer>>();
    private _sources: AudioBufferSourceNode[] = [];
    private _lastEvents: SoundEvent[] = [];
    private _lastBuffers: (AudioBuffer | undefined)[] = [];
    private _muted = false;

    constructor(ctx?: AudioContext) {
        this._ctx = ctx ?? new AudioContext();
        this._gain = this._ctx.createGain();
        this._gain.connect(this._ctx.destination);
    }

    get context(): AudioContext {
        return this._ctx;
    }

    get muted(): boolean {
        return this._muted;
    }

    set muted(value: boolean) {
        this._muted = value;
        this._gain.gain.value = value ? 0 : 1;
    }

    stop(): void {
        for (const src of this._sources) try {src.stop();} catch {}
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
        return Promise.all(events.map(e => this._loadBuffer(e).catch(() => undefined)));
    }

    private _schedule(events: SoundEvent[], buffers: ReadonlyArray<AudioBuffer | undefined>): void {
        const startAt = this._ctx.currentTime;
        for (let i = 0; i < events.length; i++) {
            const buf = buffers[i];
            if (!buf) continue;
            this._pushBuffer(buf, startAt, events[i]!);
        }
    }

    private _pushBuffer(buffer:AudioBuffer, currentTime: number, event: SoundEvent) {
        const src = this._ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(this._gain);
        src.start(currentTime + Math.max(0, event.startTime));
        this._sources.push(src);
    }


    async replayOnLoop(frameIndex: number): Promise<void> {
        if (this._lastEvents.length === 0 || frameIndex === 0) return;

        const toPlay: { event: SoundEvent; buffer: AudioBuffer }[] = [];
        for (let i = 0; i < this._lastEvents.length; i++) {
            const event = this._lastEvents[i]!;
            const buffer = this._lastBuffers[i];
            if (!buffer) continue;
            if (frameIndex % event.frameCount !== 0) continue;
            toPlay.push({event, buffer});
        }
        if (toPlay.length === 0) return;
        if (this._ctx.state === 'suspended') await this._ctx.resume();

        const startAt = this._ctx.currentTime;
        for (const {buffer, event} of toPlay) this._pushBuffer(buffer, startAt, event)
    }

    private async _loadBuffer(event: SoundEvent): Promise<AudioBuffer> {
        let pending = this._cache.get(event.soundPath);
        if (!pending) {
            pending = (async () => this._ctx.decodeAudioData(await getLoader().audioBytes(event)))();
            this._cache.set(event.soundPath, pending);
        }
        return pending;
    }
}
