import type {
    AnimatedObjectDefinition,
    BodyData,
    BoneBundle,
    MetadataRoot,
    SkinAsset,
    SkinBundle,
    SkinSlotRuleData,
    TextureSource
} from './types';

export type ImageDecoder = (bytes: Uint8Array, path: string) => Promise<TextureSource>;

const enum StreamingAssets {
    Map_Data = "Map/Data",
    Map_Textures1 = "Map/Textures/1x",
    Map_Textures2 = "Map/Textures/2x",
    Map_Textures4 = "Map/Textures/4x",
    Map_Textures_Effects = "Map/Textures/Effects",
    Data = "Data",
    Picto_Items = "Picto/Items",
    Picto_Monsters = "Picto/Monsters",
    Picto_Spells = "Picto/Spells",
    Picto_UI = "Picto/UI",
    Picto_Worldmaps = "Picto/Worldmaps",
    Animations = "Animations/Props",
    Skins = "Characters/Skins",
    Bones = "Characters/Bones",
    I18n = "I18n",
    Audio = "Audio/Banks/Desktop",
}

const enum DataBundle {
    SkinSlot = "skinslotsrulesdataroot",
    Body = "bodiesdataroot",
}

export type DataConfig =
    | { strategy: 'url'; basePath: string }
    | { strategy: 'fs'; basePath: string; decodeImage?: ImageDecoder };


export abstract class DataLoader {
    protected readonly _base: string;

    constructor(basePath: string) {
        this._base = basePath.endsWith('/') ? basePath : `${basePath}/`;
    }

    protected abstract json<T>(path: string): Promise<T>;

    protected abstract binary(path: string): Promise<ArrayBuffer>;

    protected abstract image(path: string): Promise<TextureSource>;

    protected async data<T>(name: string): Promise<Record<string, T>> {
        const raw = await this.json<MetadataRoot<T>>(`${StreamingAssets.Data}/${name}.json`);
        return raw.objectsById;
    }

    protected images(folder: string, textures: Array<{ m_PathID: string }>): Promise<TextureSource[]> {
        return Promise.all(textures.map(t => this.image(`${folder}/${t.m_PathID}.png`)));
    }

    protected async loadSkinInternal(path: string): Promise<SkinBundle> {
        const skin = await this.json<SkinAsset>(`${path}/skin.json`);
        return {skin, images: await this.images(path, skin.textures)};
    }

    async loadAnimationData(boneName: string, animName: string): Promise<ArrayBuffer> {
        return this.binary(`${StreamingAssets.Bones}/${boneName}/${animName}.dat`);
    }

    async loadSkin(skinId: number): Promise<SkinBundle> {
        return this.loadSkinInternal(`${StreamingAssets.Skins}/${skinId}`);
    }

    async loadBone(boneName: string): Promise<BoneBundle> {
        const skin = await this.loadSkinInternal(`${StreamingAssets.Bones}/${boneName}`);
        const bone = await this.json<AnimatedObjectDefinition>(`${StreamingAssets.Bones}/${boneName}/bone.json`);
        return {bone, skin};
    }

    async loadBodies(): Promise<Record<string, BodyData>> {
        return this.data(DataBundle.Body);
    }

    async loadSkinSlots(): Promise<Record<string, SkinSlotRuleData>> {
        return this.data(DataBundle.SkinSlot)
    }
}

class UrlLoader extends DataLoader {
    protected async json<T>(path: string): Promise<T> {
        const res = await fetch(this._base + path);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`);
        return res.json();
    }

    protected async binary(path: string): Promise<ArrayBuffer> {
        const res = await fetch(this._base + path);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`);
        return res.arrayBuffer();
    }

    protected async image(path: string): Promise<TextureSource> {
        const res = await fetch(this._base + path);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`);
        return createImageBitmap(await res.blob());
    }
}

class FsLoader extends DataLoader {
    private readonly _decodeImage: ImageDecoder | undefined;

    constructor(basePath: string, decodeImage?: ImageDecoder) {
        super(basePath);
        this._decodeImage = decodeImage;
    }

    private async readFile(path: string): Promise<Uint8Array> {
        const {readFile} = await import('node:fs/promises');
        return readFile(this._base + path);
    }

    protected async json<T>(path: string): Promise<T> {
        const buf = await this.readFile(path);
        return JSON.parse(new TextDecoder().decode(buf));
    }

    protected async binary(path: string): Promise<ArrayBuffer> {
        const buf = await this.readFile(path);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }

    protected async image(path: string): Promise<TextureSource> {
        if (this._decodeImage) {
            const bytes = await this.readFile(path);
            return this._decodeImage(bytes, path);
        }
        if (typeof createImageBitmap !== 'undefined') {
            const ab = await this.binary(path);
            return createImageBitmap(new Blob([ab]));
        }
        throw new Error("No image decoder available — pass `decodeImage` in the 'fs' config (e.g. using sharp or @napi-rs/canvas) when running under Node.");
    }
}

export function createDataLoader(config: DataConfig): DataLoader {
    switch (config.strategy) {
        case "url":
            return new UrlLoader(config.basePath);
        case "fs":
            return new FsLoader(config.basePath, config.decodeImage);
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
