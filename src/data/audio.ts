import {type SoundBoneData} from "./types";
import {getLoader} from "./loader";

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

    async getSoundAnim(soundData: ReadonlyArray<readonly [string, number, number]>, fps: number = 60): Promise<SoundEvent[]> {
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
                for (const trigger of eventData.triggers) {
                    let soundPath: string;
                    if (trigger.type === 'Waveform') {
                        soundPath = `${eventPath}/${trigger.sampleFile}`;
                    } else if (trigger.type === 'Multi' && trigger.playlist) {
                        const sound = trigger.playlist.entries.find(e => e.type === 'Waveform');
                        if (!sound) continue;
                        soundPath = `${eventPath}/${trigger.instrumentId}/${sound.sampleFile}`;
                    } else {
                        continue;
                    }
                    for (const startFrame of startFrames.split('|')) {
                        const startTime = ((parseInt(startFrame, 10) - 1) / fps) + trigger.start;
                        result.push({soundPath, timestamp, startTime, frameCount});
                    }
                }
            }
        }
        return result;
    }
}

let _audioManagerPromise: Promise<AudioManager> | undefined;

export function getAudioManager(): Promise<AudioManager> {
    return _audioManagerPromise ??= AudioManager.create();
}
