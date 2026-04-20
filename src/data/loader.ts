import type {
    AnimatedObjectDefinition,
    BodyData,
    BoneBundle,
    MetadataRoot,
    SkinAsset,
    SkinBundle,
    SkinSlotRuleData
} from './types';

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


export abstract class DataLoader {
    protected readonly _base: string;

    constructor(basePath: string) {
        this._base = basePath.endsWith('/') ? basePath : `${basePath}/`;
    }

    protected abstract json<T>(path: string): Promise<T>;

    protected abstract binary(path: string): Promise<ArrayBuffer>;

    protected abstract image(path: string): Promise<ImageBitmap>;

    protected async data<T>(name: string): Promise<Record<string, T>> {
        const raw = await this.json<MetadataRoot<T>>(`${StreamingAssets.Data}/${name}.json`);
        return raw.objectsById;
    }

    protected images(folder: string, textures: Array<{ m_PathID: string }>): Promise<ImageBitmap[]> {
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

export class UrlLoader extends DataLoader {
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

    protected async image(path: string): Promise<ImageBitmap> {
        const res = await fetch(this._base + path);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`);
        return createImageBitmap(await res.blob());
    }
}

export function createDataLoader(config: DataConfig): DataLoader {
    switch (config.strategy) {
        case "url":
            return new UrlLoader(config.basePath);
        default:
            throw new Error(`Unknown strategy: ${config.strategy}`);
    }
}

declare const __DATA_STRATEGY__: string;
declare const __DATA_BASE_PATH__: string;

export interface DataConfig {
    strategy: string;
    basePath: string;
}

const defaultConfig: DataConfig = {strategy: __DATA_STRATEGY__, basePath: __DATA_BASE_PATH__};
export const loader = createDataLoader(defaultConfig);

// todo add other loader strategy that extend dataLoader:
//  - local file to work with node without browser
//  - python + unitypy to add a rendering mode without extraction
//  - ...
