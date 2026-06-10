import {type SoundBoneData, type FmodTrigger, type FmodParameterInstrument} from "./types";
import {getLoader} from "./loader";


// if BARKS_LABEL change avoid hardcoded it and get it directly from AudioManagerLibrary.m_parameterInfoSet ... label
const BARKS_LABEL = [19, 18, 13, 12, 33, 32, 15, 14, 7, 6, 3, 2, 35, 34, 17, 16, 5, 4, 37, 36, 25, 24, 27, 26, 23, 22, 21, 20, 9, 8, 31, 30, 11, 10, 29, 28, 41, 40]

export interface SoundEvent {
    soundPath: string;
    timestamp: number
    startTime: number;
    frameCount: number;
}

export class AudioManager {
    private readonly _guidMapping: ReadonlyMap<string, [string, number]>;
    private readonly _boneData: ReadonlyMap<number, SoundBoneData>;

    private constructor(audio_lib: Map<string, [string, number]>, boneData: Record<string, SoundBoneData>) {
        const bones = new Map<number, SoundBoneData>();
        for (const [id, value] of Object.entries(boneData)) bones.set(Number(id), value);
        this._boneData = bones;
        this._guidMapping = audio_lib;
    }

    static async create(): Promise<AudioManager> {
        const loader = getLoader();
        let audio_lib: Map<string, [string, number]>;

        try {
            const processed = await loader.loadProcessedAudioLib();
            audio_lib = new Map(Object.entries(processed));
        } catch (err) {
            const lib = await loader.loadAudioLib();
            audio_lib = new Map(lib.m_eventInfoSet.m_entries.map(i => [i.guid, [i.path.replace(/^event:\//, ""), 0]]));
        }

        const bones = await loader.loadSoundBones();
        return new AudioManager(audio_lib, bones);
    }

    async getSoundAnim(soundData: ReadonlyArray<readonly [string, number, number]>, fps: number = 60, breedKey?: number): Promise<SoundEvent[]> {
        const result: SoundEvent[] = [];
        const loader = getLoader();
        for (const [anim, boneId, frameCount] of soundData) {
            const boneSound = this._boneData.get(boneId);
            if (!boneSound) continue;
            const animSound = boneSound.animSounds[anim];
            if (!animSound) continue;
            const count = Math.min(animSound.guids.length, animSound.startFrames.length);
            for (let i = 0; i < count; i++) {
                const guid = animSound.guids[i]!;
                const startFrames = animSound.startFrames[i]!;
                const eventInfo = this._guidMapping.get(guid);
                if (!eventInfo) continue;
                const [eventPath, timestamp] = eventInfo
                let eventData;
                try {
                    eventData = await loader.fmodEvent(eventPath, timestamp);
                } catch {
                    continue;
                }
                if (!eventData) continue;

                for (const trigger of eventData.triggers) this.pushAudio(result, trigger, eventPath, startFrames, fps, timestamp, frameCount);
                if (breedKey!==undefined) {
                    const paramIndex = BARKS_LABEL.indexOf(breedKey);
                    if (paramIndex === -1) continue;
                    for (const parameters of eventData.parameterGroups) {
                        if (parameters.parameter !== "Player/Classes_Barks") continue;
                        const param = parameters.instruments.find(
                            p => paramIndex >= p.parameterRange.min && paramIndex < p.parameterRange.max
                        );
                        if (param) this.pushAudio(result, param, eventPath, startFrames, fps, timestamp, frameCount);
                    }
                }
            }
        }
        return result;
    }

    private pushAudio(result:SoundEvent[] ,trigger: FmodTrigger | FmodParameterInstrument, eventPath:string, startFrames:string, fps:number, timestamp:number, frameCount:number) {
        const soundPath = this.resolveSoundPath(eventPath, trigger);
        if (!soundPath) return;
        const start = trigger.start ?? 0
        for (const startFrame of startFrames.split('|')) {
            const startTime = ((parseInt(startFrame, 10) - 1) / fps) + start;
            result.push({soundPath, timestamp, startTime, frameCount});
        }
    }

    private resolveSoundPath(eventPath: string, trigger: FmodTrigger | FmodParameterInstrument): string | null {
        if (trigger.type === 'Waveform') {
            return `${eventPath}/${trigger.sampleFile}`;
        }
        if (trigger.type === 'Multi' && trigger.playlist) {
            const sound = trigger.playlist.entries.find(e => e.type === 'Waveform');
            if (!sound) return null;
            return `${eventPath}/${trigger.instrumentId}/${sound.sampleFile}`;
        }
        return null;
    }
}

let _audioManagerPromise: Promise<AudioManager> | undefined;

export function getAudioManager(): Promise<AudioManager> {
    return _audioManagerPromise ??= AudioManager.create();
}
