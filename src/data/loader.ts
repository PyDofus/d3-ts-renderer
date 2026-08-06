import type {
    AnimatedObjectDefinition, AudioManagerLibrary,
    BodyData,
    BoneBundle, BreedsData,
    FmodEvent,
    MetadataRoot,
    SkinAsset,
    SkinBundle,
    SkinSlotRuleData, SoundBoneData,
    TextureSource
} from './types';
import type {SoundEvent} from "./audio";

export type ImageDecoder = (bytes: Uint8Array, path: string) => Promise<TextureSource>;

const enum StreamingAssets {
    aa = "aa",
    Map_Data = "Content/Map/Data",
    Map_Textures1 = "Content/Map/Textures/1x",
    Map_Textures2 = "Content/Map/Textures/2x",
    Map_Textures4 = "Content/Map/Textures/4x",
    Map_Textures_Effects = "Content/Map/Textures/Effects",
    Data = "Content/Data",
    Picto_Items = "Content/Picto/Items",
    Picto_Monsters = "Content/Picto/Monsters",
    Picto_Spells = "Content/Picto/Spells",
    Picto_UI = "Content/Picto/UI",
    Picto_Worldmaps = "Content/Picto/Worldmaps",
    Animations = "Content/Animations/Props",
    Skins = "Content/Characters/Skins",
    Bones = "Content/Characters/Bones",
    I18n = "Content/I18n",
    Audio = "Content/Audio/Banks/Desktop",
}

const enum BundleFile {
    SkinSlot = "skinslotsrulesdataroot",
    Body = "bodiesdataroot",
    Breed = "breedsdataroot",
    SoundBone = "soundbonesdataroot",
    audioLib = "Assets/Configuration/Audio/AudioManagerLibrary.asset",
    processedAudioLib = "audio_manager.json",
    changeTable = "Content/Characters/table.json",
    version= "version.json"
}

export interface LoaderOptions {
    /** Load `version.json` and append the global `?t=<BuildDate>` cache-buster to JSON requests. Default `false`. */
    enableVersion?: boolean;
    /** Load `Content/Characters/table.json` and append per-asset `?t=` cache-busters to bone/skin/animation requests. Default `false`. */
    enableCharacterTable?: boolean;
    /** Enable the audio library (`audio_manager.json` / `AudioManagerLibrary.asset`). When off, no sound event is resolved. Default `false`. */
    enableAudio?: boolean;
}

export interface DataConfig extends LoaderOptions {
    strategy: 'url' | 'fs'|'LE';
    basePath: string;
    decodeImage?: ImageDecoder;
    ImageExtension?: 'png'|'webp';
}

export class HttpError extends Error {
    readonly status: number;

    constructor(status: number, path: string) {
        super(`HTTP ${status} fetching ${path}`);
        this.status = status;
    }
}


export abstract class DataLoader {
    protected readonly _base: string;
    protected readonly _decodeImage: ImageDecoder | undefined;
    protected readonly _imgExtension: string;
    protected readonly _enableVersion: boolean;
    protected readonly _enableCharacterTable: boolean;
    protected readonly _enableAudio: boolean;

    constructor(basePath: string, imgExtension:string="png",decodeImage?: ImageDecoder, options: LoaderOptions = {}) {
        this._base = basePath.endsWith('/') ? basePath : `${basePath}/`;
        this._decodeImage = decodeImage;
        this._imgExtension = imgExtension;
        this._enableVersion = options.enableVersion ?? false;
        this._enableCharacterTable = options.enableCharacterTable ?? false;
        this._enableAudio = options.enableAudio ?? false;
    }

    protected abstract bytes(path: string): Promise<Uint8Array>;

    protected abstract json<T>(path: string): Promise<T>;

    protected abstract binary(path: string): Promise<ArrayBuffer>

    protected abstract imageBitmap(path: string): Promise<ImageBitmap>

    protected async image(path: string): Promise<TextureSource> {
        if (this._decodeImage) return this._decodeImage(await this.bytes(path), path);
        return this.imageBitmap(path);
    }

    protected async data<T>(name: string): Promise<Record<string, T>> {
        const raw = await this.json<MetadataRoot<T>>(`${StreamingAssets.Data}/${name}.json`);
        return raw.objectsById;
    }

    protected images(folder: string, textures: unknown[]): Promise<TextureSource[]> {
        return Promise.all(textures.map((_, i) => this.image(`${folder}/${i}.${this._imgExtension}`)));
    }

    protected async loadSkinInternal(path: string): Promise<SkinBundle> {
        const skin = await this.json<SkinAsset>(`${path}/skin.json`);
        return {skin, images: await this.images(path, skin.textures)};
    }

    async loadAnimationData(boneName: string, animName: string, isMapAnimation?: boolean): Promise<ArrayBuffer> {
        return this.binary(`${isMapAnimation? StreamingAssets.Animations: StreamingAssets.Bones}/${boneName}/${animName}.dat`);
    }

    async loadSkin(skinId: number): Promise<SkinBundle> {
        return this.loadSkinInternal(`${StreamingAssets.Skins}/${skinId}`);
    }

    async loadBone(boneName: string, isMapAnimation?: boolean): Promise<BoneBundle> {
        const folder = `${isMapAnimation? StreamingAssets.Animations: StreamingAssets.Bones}/${boneName}`
        const skinPromise = this.loadSkinInternal(folder);
        const bonePromise = this.json<AnimatedObjectDefinition>(`${folder}/bone.json`);
        const [skin, bone] = await Promise.all([skinPromise, bonePromise]);
        return {bone, skin};
    }

    async loadBodies(): Promise<Record<string, BodyData>> {
        return this.data(BundleFile.Body);
    }

    async loadBreeds(): Promise<Record<string, BreedsData>> {
        return this.data(BundleFile.Breed);
    }

    async loadSkinSlots(): Promise<Record<string, SkinSlotRuleData>> {
        return this.data(BundleFile.SkinSlot)
    }

    async loadSoundBones(): Promise<Record<string,SoundBoneData>> {
        return this.data(BundleFile.SoundBone)
    }

    /** Whether the audio library may be loaded (`enableAudio`). */
    get audioEnabled(): boolean {
        return this._enableAudio;
    }

    async loadAudioLib(): Promise<AudioManagerLibrary> {
        if (!this._enableAudio) throw new Error("Audio is disabled. Pass enableAudio: true to configure().");
        return this.json(`${StreamingAssets.aa}/${BundleFile.audioLib}`)
    }

    async loadProcessedAudioLib(): Promise<Record<string, [string, number]>> {
        if (!this._enableAudio) return {};
        return this.json(`${StreamingAssets.Audio}/${BundleFile.processedAudioLib}`)
    }

    async fmodEvent(eventPath: string, _: number): Promise<FmodEvent>  {
        return this.json(`${StreamingAssets.Audio}/${eventPath}/info.json`)
    }

    async audioBytes(event: SoundEvent): Promise<ArrayBuffer> {
        return this.binary(`${StreamingAssets.Audio}/${event.soundPath}`);
    }
}

class UrlLoader extends DataLoader {
    private cacheTable: Record<"Bones"|"Skins", Map<string, number>>;
    private buildTime: number = 0;
    private tablesReady: Promise<void> = Promise.resolve();

    constructor(basePath: string, imgExtension:string="png" , decodeImage?: ImageDecoder, options: LoaderOptions = {}) {
        super(basePath, imgExtension, decodeImage, options);
        this.cacheTable = {Bones: new Map(), Skins: new Map()};
        if (typeof window !== "undefined") {
            const tasks: Promise<void>[] = [];
            if (this._enableCharacterTable) tasks.push(this.setCache());
            if (this._enableVersion) tasks.push(this.setBuildTime());
            if (tasks.length) this.tablesReady = Promise.all(tasks).then(() => {});
        }

    }

    private async setCache():Promise<void> {
        try {
            const data = await this.json<Record<any, any>>(BundleFile.changeTable);
            this.cacheTable = {
                Bones: new Map(Object.entries(data?.Bones ?? {})),
                Skins: new Map(Object.entries(data?.Skins ?? {})),
            };
        } catch (e) {}
    }

    private async setBuildTime(): Promise<void> {
        try {
            const data = await this.json<{ BuildDate?: number }>(`${BundleFile.version}?t=${Date.now()}`);
            this.buildTime = data?.BuildDate ?? 0;
        } catch (e) {}
    }

    private withBuildTime(path: string): string {
        if (!this.buildTime || path.includes('?t=')) return path;
        const sep = path.includes('?') ? '&' : '?';
        return `${path}${sep}t=${this.buildTime}`;
    }

    protected async fetchRes(path: string): Promise<Response> {
        const attempts = 3;
        for (let attempt = 1; ; attempt++) {
            let res: Response | undefined;
            try {
                res = await fetch(this._base + path, {signal: AbortSignal.timeout(30_000)});
            } catch (err) {
                if (attempt >= attempts) throw err;
            }
            if (res) {
                if (res.ok) return res;
                if (res.status === 404 || attempt >= attempts) throw new HttpError(res.status, path);
            }
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
    }

    protected async json<T>(path: string): Promise<T> {
        return (await this.fetchRes(this.withBuildTime(path))).json();
    }

    protected async binary(path: string): Promise<ArrayBuffer> {
        return (await this.fetchRes(path)).arrayBuffer();
    }

    protected async bytes(path: string): Promise<Uint8Array> {
        const buf = await (await this.fetchRes(path)).arrayBuffer();
        return new Uint8Array(buf);
    }

    protected async imageBitmap(path: string): Promise<ImageBitmap> {
        const res = await this.fetchRes(path);
        const blob = await res.blob();
        return createImageBitmap(blob, {premultiplyAlpha:"none"});
    }

    async fmodEvent(eventPath: string, timestamp: number): Promise<FmodEvent>  {
        return this.json(`${StreamingAssets.Audio}/${eventPath}/info.json?t=${timestamp}`)
    }

    async audioBytes(event: SoundEvent): Promise<ArrayBuffer> {
        return this.binary(`${StreamingAssets.Audio}/${event.soundPath}?t=${event.timestamp}`);
    }

    /** `?t=<timestamp>` suffix from the change table, or "" when the table is disabled. */
    private stamp(kind: "Bones"|"Skins", key: string): string {
        if (!this._enableCharacterTable) return "";
        return `?t=${this.cacheTable[kind].get(key) ?? 0}`;
    }

    protected async loadSkinWithCache(path: string, stamp:string): Promise<SkinBundle> {
        const firstImage = this.image(`${path}/0.${this._imgExtension}${stamp}`);
        firstImage.catch(() => {});
        const skin = await this.json<SkinAsset>(`${path}/skin.json${stamp}`);
        if (skin.textures.length === 0) return {skin, images: []};
        const images: Promise<TextureSource>[] = [firstImage];
        for (let i = 1; i < skin.textures.length; i++) {
            images.push(this.image(`${path}/${i}.${this._imgExtension}${stamp}`));
        }
        return {skin, images: await Promise.all(images)};
    }

    async loadAnimationData(boneName: string, animName: string, isMapAnimation?: boolean): Promise<ArrayBuffer> {
        await this.tablesReady;
        const stamp = this.stamp("Bones", boneName)
        return this.binary(`${isMapAnimation? StreamingAssets.Animations: StreamingAssets.Bones}/${boneName}/${animName}.dat${stamp}`);
    }

    async loadSkin(skinId: number): Promise<SkinBundle> {
        await this.tablesReady;
        const stamp = this.stamp("Skins", String(skinId))
        return this.loadSkinWithCache(`${StreamingAssets.Skins}/${skinId}`, stamp);
    }

    async loadBone(boneName: string, isMapAnimation?: boolean): Promise<BoneBundle> {
        await this.tablesReady;
        const stamp = this.stamp("Bones", boneName)
        const folder = `${isMapAnimation? StreamingAssets.Animations: StreamingAssets.Bones}/${boneName}`
        const skinPromise = this.loadSkinWithCache(folder, stamp);
        const bonePromise = this.json<AnimatedObjectDefinition>(`${folder}/bone.json${stamp}`);
        const [skin, bone] = await Promise.all([skinPromise, bonePromise])
        return {bone, skin};
    }

}

class LiveExtractLoader extends UrlLoader {
    private generated: Record<"Bones"|"Skins", Set<string>>;
    private readonly apiUrl: string;
    constructor(basePath: string, imgExtension:string="png" , decodeImage?: ImageDecoder, options: LoaderOptions = {}) {
        const cleanPath = basePath.endsWith('/') ? basePath : `${basePath}/`;
        super(`${cleanPath}static/Dofus_Data/StreamingAssets`, imgExtension, decodeImage, options);
        this.generated = {Bones: new Set(), Skins: new Set()};
        this.apiUrl = cleanPath;
    }

    async loadSkin(skinId: number): Promise<SkinBundle> {
        if (!this.generated.Skins.has(String(skinId))) {
            await this.fetchResApi(`extract/skin/${skinId}`)
            this.generated.Skins.add(String(skinId));
        }
        return super.loadSkin(skinId);
    }

    async loadBone(boneName: string, isMapAnimation: boolean=false): Promise<BoneBundle> {
        if (!this.generated.Bones.has(boneName)) {
            await this.fetchResApi(`extract/bone/${isMapAnimation}/${boneName}`)
            this.generated.Bones.add(boneName);
        }
        return super.loadBone(boneName, isMapAnimation)
    }

    async loadProcessedAudioLib(): Promise<Record<string, [string, number]>> {
        return {} // no audio support
    }

    protected async fetchResApi(path: string): Promise<Response> {
        const res = await fetch(this.apiUrl + path);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`);
        return res;
    }

}

export function toLoaderOptions(config: DataConfig): LoaderOptions {
    return {
        enableVersion: config.enableVersion,
        enableCharacterTable: config.enableCharacterTable,
        enableAudio: config.enableAudio,
    };
}

export function createDataLoader(config: DataConfig): DataLoader {
    const options = toLoaderOptions(config);
    switch (config.strategy) {
        case "url":
            return new UrlLoader(config.basePath, config.ImageExtension, config.decodeImage, options);
        case "LE":
            return new LiveExtractLoader(config.basePath, config.ImageExtension, config.decodeImage, options)
        default:
            throw new Error(`Unknown loader strategy "${config.strategy}". The "fs" strategy is Node-only: import configure/createDataLoader from 'd3-ts-renderer/node' instead of 'd3-ts-renderer'.`);
    }
}

let _loader: DataLoader | undefined;

export function setLoader(loader: DataLoader): DataLoader {
    _loader = loader;
    return loader;
}

export function configure(config: DataConfig): DataLoader {
    return setLoader(createDataLoader(config));
}

export function getLoader(): DataLoader {
    if (!_loader) {
        throw new Error("DataLoader not configured. Call configure({strategy, basePath}) before using the renderer.");
    }
    return _loader;
}
