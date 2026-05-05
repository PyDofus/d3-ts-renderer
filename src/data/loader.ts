import type {
    AnimatedObjectDefinition, AudioManagerLibrary,
    BodyData,
    BoneBundle,
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
    SoundBone = "soundbonesdataroot",
    audioLib = "Assets/Configuration/Audio/AudioManagerLibrary.asset",
    processedAudioLib = "audio_manager.json",
    changeTable = "Content/Characters/table.json"
}

export interface DataConfig {
    strategy: 'url' | 'fs'|'LE';
    basePath: string;
    decodeImage?: ImageDecoder;
    ImageExtension?: string;
}


export abstract class DataLoader {
    protected readonly _base: string;
    protected readonly _decodeImage: ImageDecoder | undefined;
    protected readonly _imgExtension: string;

    constructor(basePath: string, imgExtension:string="png",decodeImage?: ImageDecoder) {
        this._base = basePath.endsWith('/') ? basePath : `${basePath}/`;
        this._decodeImage = decodeImage;
        this._imgExtension = imgExtension;
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

    protected images(folder: string, textures: Array<{ m_PathID: string }>): Promise<TextureSource[]> {
        return Promise.all(textures.map(t => this.image(`${folder}/${t.m_PathID}.${this._imgExtension}`)));
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
        const [skin, bone] = await Promise.all([skinPromise, bonePromise])
        return {bone, skin};
    }

    async loadBodies(): Promise<Record<string, BodyData>> {
        return this.data(BundleFile.Body);
    }

    async loadSkinSlots(): Promise<Record<string, SkinSlotRuleData>> {
        return this.data(BundleFile.SkinSlot)
    }

    async loadSoundBones(): Promise<Record<string,SoundBoneData>> {
        return this.data(BundleFile.SoundBone)
    }

    async loadAudioLib(): Promise<AudioManagerLibrary> {
        return this.json(`${StreamingAssets.aa}/${BundleFile.audioLib}`)
    }

    async loadProcessedAudioLib(): Promise<Record<string, [string, number]>> {
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
    constructor(basePath: string, imgExtension:string="png" , decodeImage?: ImageDecoder) {
        super(basePath, imgExtension, decodeImage);
        this.cacheTable = {Bones: new Map(), Skins: new Map()};
        if (typeof window !== "undefined") void this.setCache();

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

    protected async fetchRes(path: string): Promise<Response> {
        const res = await fetch(this._base + path);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`);
        return res;
    }

    protected async json<T>(path: string): Promise<T> {
        return (await this.fetchRes(path)).json();
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
        return createImageBitmap(blob);
    }

    async fmodEvent(eventPath: string, timestamp: number): Promise<FmodEvent>  {
        return this.json(`${StreamingAssets.Audio}/${eventPath}/info.json?t=${timestamp}`)
    }

    async audioBytes(event: SoundEvent): Promise<ArrayBuffer> {
        return this.binary(`${StreamingAssets.Audio}/${event.soundPath}?t=${event.timestamp}`);
    }

    protected async loadSkinWithCache(path: string, timestamp:number): Promise<SkinBundle> {
        const firstImage = this.image(`${path}/0.${this._imgExtension}?t=${timestamp}`);
        firstImage.catch(() => {});
        const skin = await this.json<SkinAsset>(`${path}/skin.json?t=${timestamp}`);
        if (skin.textures.length === 0) return {skin, images: []};
        const images: Promise<TextureSource>[] = [firstImage];
        for (let i = 1; i < skin.textures.length; i++) {
            images.push(this.image(`${path}/${i}.${this._imgExtension}?t=${timestamp}`));
        }
        return {skin, images: await Promise.all(images)};
    }

    async loadAnimationData(boneName: string, animName: string, isMapAnimation?: boolean): Promise<ArrayBuffer> {
        const timestamp = this.cacheTable.Bones.get(boneName) ?? 0
        return this.binary(`${isMapAnimation? StreamingAssets.Animations: StreamingAssets.Bones}/${boneName}/${animName}.dat?t=${timestamp}`);
    }

    async loadSkin(skinId: number): Promise<SkinBundle> {
        const timestamp = this.cacheTable.Skins.get(String(skinId)) ?? 0
        return this.loadSkinWithCache(`${StreamingAssets.Skins}/${skinId}`, timestamp);
    }

    async loadBone(boneName: string, isMapAnimation?: boolean): Promise<BoneBundle> {
        const timestamp = this.cacheTable.Bones.get(boneName) ?? 0
        const folder = `${isMapAnimation? StreamingAssets.Animations: StreamingAssets.Bones}/${boneName}`
        const skinPromise = this.loadSkinWithCache(folder, timestamp);
        const bonePromise = this.json<AnimatedObjectDefinition>(`${folder}/bone.json?t=${timestamp}`);
        const [skin, bone] = await Promise.all([skinPromise, bonePromise])
        return {bone, skin};
    }

}

class FsLoader extends DataLoader {
    protected async bytes(path: string): Promise<Uint8Array> {
        const {readFile} = await import('node:fs/promises');
        return readFile(this._base + path);
    }

    protected async json<T>(path: string): Promise<T> {
        const buf = await this.bytes(path);
        return JSON.parse(new TextDecoder().decode(buf));
    }

    protected async binary(path: string): Promise<ArrayBuffer> {
        const buf = await this.bytes(path);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }

    protected async imageBitmap(path: string): Promise<ImageBitmap> {
        throw new Error("FsLoader cannot decode ImageBitmap in Node. Provide decodeImage in config or DataLoader constructor.");
    }

}

class LiveExtractLoader extends UrlLoader {
    private generated: Record<"Bones"|"Skins", Set<string>>;
    private readonly apiUrl: string;
    constructor(basePath: string, imgExtension:string="png" , decodeImage?: ImageDecoder) {
        super(`${basePath}/static/Dofus_Data/StreamingAssets/Content`, imgExtension, decodeImage);
        this.generated = {Bones: new Set(), Skins: new Set()};
        this.apiUrl = basePath;
    }

    async loadSkin(skinId: number): Promise<SkinBundle> {
        if (!this.generated.Skins.has(String(skinId))) {
            await this.fetchRes(`${this.apiUrl}/extract/skin/${skinId}`)
            this.generated.Skins.add(String(skinId));
        }
        return super.loadSkin(skinId);
    }

    async loadBone(boneName: string, isMapAnimation: boolean=false): Promise<BoneBundle> {
        if (!this.generated.Bones.has(boneName)) {
            await this.fetchRes(`${this.apiUrl}/extract/bine/${isMapAnimation}/${boneName}`)
            this.generated.Bones.add(boneName);
        }
        return super.loadBone(boneName, isMapAnimation)
    }

    async loadProcessedAudioLib(): Promise<Record<string, [string, number]>> {
        return {} // no audio support
    }

}

export function createDataLoader(config: DataConfig): DataLoader {
    switch (config.strategy) {
        case "url":
            return new UrlLoader(config.basePath, config.ImageExtension, config.decodeImage);
        case "fs":
            return new FsLoader(config.basePath, config.ImageExtension, config.decodeImage);
        case "LE":
            return new LiveExtractLoader(config.basePath, config.ImageExtension, config.decodeImage)
    }
}

let _loader: DataLoader | undefined;

export function configure(config: DataConfig): DataLoader {
    _loader = createDataLoader(config);
    return _loader;
}

export function getLoader(): DataLoader {
    if (!_loader) {
        throw new Error("DataLoader not configured. Call configure({strategy, basePath}) before using the renderer.");
    }
    return _loader;
}
