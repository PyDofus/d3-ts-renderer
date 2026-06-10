import {getBoneData} from '../data/boneLoader';
import {getSkin} from '../data/skinLoader';
import type {AnimatedObjectDefinition, SkinAsset} from '../data/types';
import type {RendererContext} from './rendererContext';

export interface BoneResource {
    data: AnimatedObjectDefinition;
    boneAsset: SkinAsset;
    textureBase: number;
    textureCount: number;
}

export interface SkinResource {
    skin: SkinAsset;
    textureBase: number;
    textureCount: number;
}

interface Entry<T> {
    promise: Promise<T>;
    resolved?: T;
}

/**
 * Per-RendererContext pool of bone and skin resources shared by the root sprite and every sub-entity
 */
export class AssetStore {
    private readonly _bones = new Map<string, Entry<BoneResource>>();
    private readonly _skins = new Map<number, Entry<SkinResource>>();

    constructor(private readonly _ctx: RendererContext) {}

    bone(key: string, isMapAnimation: boolean): Promise<BoneResource> {
        const existing = this._bones.get(key);
        if (existing) return existing.promise;
        const entry: Entry<BoneResource> = {promise: this._loadBone(key, isMapAnimation)};
        entry.promise.then(r => (entry.resolved = r)).catch(() => this._bones.delete(key));
        this._bones.set(key, entry);
        return entry.promise;
    }

    private async _loadBone(resolvedName: string, isMapAnimation: boolean): Promise<BoneResource> {
        const {bone, skin} = await getBoneData(resolvedName, isMapAnimation);
        const textureBase = this._ctx.loadTextureBlock(skin.images);
        return {data: bone, boneAsset: skin.skin, textureBase, textureCount: skin.images.length};
    }

    skin(id: number): Promise<SkinResource> {
        const existing = this._skins.get(id);
        if (existing) return existing.promise;
        const entry: Entry<SkinResource> = {promise: this._loadSkin(id)};
        entry.promise.then(r => (entry.resolved = r)).catch(() => this._skins.delete(id));
        this._skins.set(id, entry);
        return entry.promise;
    }

    private async _loadSkin(id: number): Promise<SkinResource> {
        const {skin, images} = await getSkin(id);
        const textureBase = this._ctx.loadTextureBlock(images);
        return {skin, textureBase, textureCount: images.length};
    }

    /** Free every bone/skin block not present in the live sets. Run once, from the root. */
    sweep(liveBones: ReadonlySet<string>, liveSkins: ReadonlySet<number>): void {
        for (const [key, entry] of [...this._bones]) {
            if (!liveBones.has(key)) this._release(this._bones, key, entry);
        }
        for (const [id, entry] of [...this._skins]) {
            if (!liveSkins.has(id)) this._release(this._skins, id, entry);
        }
    }

    /** Free everything (full teardown). */
    clear(): void {
        this.sweep(new Set(), new Set());
    }

    private _release<K, T extends {textureBase: number; textureCount: number}>(map: Map<K, Entry<T>>, key: K, entry: Entry<T>): void {
        map.delete(key);
        if (entry.resolved) this._ctx.freeTextureBlock(entry.resolved.textureBase, entry.resolved.textureCount);
        else entry.promise.then(r => this._ctx.freeTextureBlock(r.textureBase, r.textureCount)).catch(() => {});
    }
}
