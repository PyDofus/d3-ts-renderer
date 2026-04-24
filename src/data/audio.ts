import {type AudioManagerLibrary, type SoundBoneData} from "./types";
import {getLoader} from "./loader";

export interface SoundEvent {
    soundPath: string;
    startTime: number;
}

export class AudioManager {
    private readonly _guidMapping: ReadonlyMap<string, string>;
    private readonly _boneData: ReadonlyMap<number, SoundBoneData>;

    private constructor(audioManagerLibrary: AudioManagerLibrary, boneData: Record<string, SoundBoneData>) {
        this._guidMapping = new Map(audioManagerLibrary.m_eventInfoSet.m_entries.map(i => [i.guid, i.path.replace(/^event:\//, "")]));
        const bones = new Map<number, SoundBoneData>();
        for (const [id, value] of Object.entries(boneData)) bones.set(Number(id), value);
        this._boneData = bones;
    }

    static async create(): Promise<AudioManager> {
        const loader = getLoader();
        const [lib, bones] = await Promise.all([loader.loadAudioLib(), loader.loadSoundBones()]);
        return new AudioManager(lib, bones);
    }

    async getSoundAnim(soundData: ReadonlyArray<readonly [string, number]>, fps: number = 60): Promise<SoundEvent[]> {
        const result: SoundEvent[] = [];
        const loader = getLoader();
        for (const [anim, boneId] of soundData) {
            const boneSound = this._boneData.get(boneId);
            if (!boneSound) continue;
            const animSound = boneSound.animSounds[anim];
            if (!animSound) continue;
            const count = Math.min(animSound.guids.length, animSound.startFrames.length);
            for (let i = 0; i < count; i++) {
                const guid = animSound.guids[i]!;
                const startFrames = animSound.startFrames[i]!;
                const eventPath = this._guidMapping.get(guid);
                if (!eventPath) continue;
                let eventData;
                try {
                    eventData = await loader.fmodEvent(eventPath);
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
                        result.push({soundPath, startTime});
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