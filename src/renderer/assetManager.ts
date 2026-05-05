import {getBoneData} from '../data/boneLoader';
import {getSkin} from '../data/skinLoader';
import type {AnimatedObjectDefinition, Animation, SkinAsset, TextureSource} from '../data/types';
import type {Look} from '../look/look';
import type {RenderState} from '../readers/renderState';
import {type Mat3, mat3Identity} from '../math';
import {
    type NodeElement,
    type NodeElementData,
    type NodeElementGroup,
    type NodeElementSprite
} from './nodeStructure';
import {SkinAssetPart} from './skinAssetPart';
import type {RendererContext} from './rendererContext';
import type {DofusSprite} from './dofusSprite';
import {getSkinSlots} from "../data/skinSlots";

type CustomPart = SkinAssetPart | NodeElementSprite | null;
type AssetPartResult = [found: boolean, part: CustomPart, isCustomised: boolean];

export abstract class AssetManager {
    readonly look: Look;
    readonly openGl: RendererContext;
    isMapAnimation: boolean;

    data!: AnimatedObjectDefinition;
    boneAsset!: SkinAsset;
    animations!: Map<string, Animation>;

    private _textureIndexDict = new Map<string, number>();
    private _skinsDict = new Map<number, SkinAsset>();
    private _customSymbolRef = new Map<string, SkinAsset>();
    private _intendedEmpty = new Set<string>();
    private _rulesEmpty: ReadonlySet<string> = new Set();

    private _dictPartIndex = new Map<number, SkinAssetPart>();
    private _dictPartIndexCustom = new Map<string, [CustomPart, boolean]>();
    private _dictPart = new Map<string, AssetPartResult>();
    private _processedPart = new Map<string, NodeElement>();

    protected constructor(look: Look, openGl: RendererContext, isMapAnimation?: boolean) {
        this.look = look;
        this.openGl = openGl;
        this.isMapAnimation = isMapAnimation ?? false;
    }

    protected async _init(boneName?: string): Promise<void> {
        await Promise.all([this._getBone(boneName), this._getSkinDict()]);
        this._getCustomSymbol();
        this._getEmptyCustomisation();
        const [skinSlots, body] = await Promise.all([getSkinSlots(), this.look.getBody()]);
        this._rulesEmpty = skinSlots.slotFromBody(this.look.skins, body);
        this.animations = this._getAnimationDict();
    }

    // ── Initialisation helpers ────────────────────────────────────────────────────

    protected async _getBone(boneName?: string): Promise<void> {
        const resolved = boneName ?? (this.look.bone !== 1 ? String(this.look.bone) : '1-static');
        const {bone, skin} = await getBoneData(resolved, this.isMapAnimation);
        this.data = bone;
        this.boneAsset = skin.skin;
        this._loadTextures(skin.images, 'main');
    }

    private async _getSkinDict(): Promise<void> {
        const results = new Map<number, any>(); // order is important for skinDict
        await Promise.all(
            this.look.skins.map(async skinId => {
                try {
                    const {skin, images} = await getSkin(skinId);
                    this._loadTextures(images, String(skinId));
                    results.set(skinId, skin);
                } catch {}
            }),
        );
        for (const skinId of this.look.skins) {
            const skin = results.get(skinId);
            if (skin !== undefined) this._skinsDict.set(skinId, skin);
        }
    }

    private _getCustomSymbol(): void {
        this._customSymbolRef.clear();
        for (const skin of this._skinsDict.values()) {
            for (const symbol of skin.m_keys) this._customSymbolRef.set(symbol, skin);
            for (const empty of skin.emptyCustomisations) this._customSymbolRef.delete(empty);
        }
    }

    private _getEmptyCustomisation(): void {
        this._intendedEmpty.clear();
        for (const skin of this._skinsDict.values()) {
            for (const e of skin.emptyCustomisations) this._intendedEmpty.add(e);
        }
    }

    private _loadTextures(images: TextureSource[], key: string): void {
        if (key === 'main' && this._textureIndexDict.has('main')) {
            this.openGl.loadTexture(images[0]!, this._textureIndexDict.get('main'));
        } else {
            this._textureIndexDict.set(key, this.openGl.textureCount);
            for (const img of images) this.openGl.loadTexture(img);
        }
    }

    private _getAnimationDict(): Map<string, Animation> {
        return new Map(this.data.animations.map(a => [a.name, a]));
    }

    // ── Asset resolution ──────────────────────────────────────────────────────────

    private _getSkinAssetPartByIndex(index: number): SkinAssetPart | null {
        if (index < 0 || index >= this.data.graphics.length) return null;
        const cached = this._dictPartIndex.get(index);
        if (cached) return cached;
        const graphic = this.data.graphics[index]!;
        const textureOffset = this._textureIndexDict.get('main')!;
        const part = new SkinAssetPart(graphic.part, this.boneAsset, textureOffset, this.openGl.supportsU32Indices);
        this._dictPartIndex.set(index, part);
        return part;
    }

    private _getCustomSymbolName(customIndex: number): string | undefined {
        return this.data.exposedNodeNames[customIndex];
    }

    protected _getSkinCustomAssetPart(symbolName: string): [CustomPart, boolean] {
        const cached = this._dictPartIndexCustom.get(symbolName);
        if (cached) return cached;

        if (this._rulesEmpty.has(symbolName)) {
            const r: [CustomPart, boolean] = [null, true];
            this._dictPartIndexCustom.set(symbolName, r);
            return r;
        }

        if (symbolName.startsWith('carried_')) {
            const node = this._getCarriedSubEntityNode(symbolName);
            if (node) {
                const r: [CustomPart, boolean] = [node, true];
                this._dictPartIndexCustom.set(symbolName, r);
                return r;
            }
        } else {
            const skin = this._customSymbolRef.get(symbolName);
            if (skin) {
                const textureOffset = this._textureIndexDict.get(skin.m_Name)!;
                const stub = skin.m_values[skin.m_keys.indexOf(symbolName)]!;
                const part = new SkinAssetPart(stub, skin, textureOffset, this.openGl.supportsU32Indices);
                const r: [CustomPart, boolean] = [part, true];
                this._dictPartIndexCustom.set(symbolName, r);
                return r;
            }
        }

        const r: [CustomPart, boolean] = [null, this._intendedEmpty.has(symbolName)];
        this._dictPartIndexCustom.set(symbolName, r);
        return r;
    }

    private _getCarriedSubEntityNode(index: string): NodeElementSprite | null {
        const sprite = this.getSubEntity(index);
        if (!sprite) return null;
        return {sprite, name: index, transformation: null};
    }

    getSkinAssetPart(node: RenderState): AssetPartResult {
        if (node.spriteIndex === -1 && node.customisationIndex === -1) return [false, null, false];

        const key = `${Math.max(-2, node.customisationIndex)}:${Math.max(-1, node.spriteIndex)}`;
        const cached = this._dictPart.get(key);
        if (cached) return cached;

        let isCustomised = false;
        let graphic: CustomPart = this._getSkinAssetPartByIndex(node.spriteIndex);

        if (node.customisationIndex !== -1) {
            if (graphic === null) {
                const symbolName = this._getCustomSymbolName(node.customisationIndex);
                if (symbolName) [graphic, isCustomised] = this._getSkinCustomAssetPart(symbolName);
            } else {
                [graphic, isCustomised] = this._getSkinCustomAssetPart(graphic.name);
            }
        }

        const result: AssetPartResult = graphic === null ? [false, null, isCustomised] : [(graphic instanceof SkinAssetPart ? graphic.validSkinChunk : true), graphic, isCustomised];

        this._dictPart.set(key, result);
        return result;
    }

    // ── Part processing ───────────────────────────────────────────────────────────

    processPart(part: SkinAssetPart | NodeElementSprite): NodeElement {
        const name = part.name;
        const cached = this._processedPart.get(name);
        if (cached) return cached;

        const data: NodeElementGroup[] = part instanceof SkinAssetPart ? this._iterEntry(part) : [[part]];
        const node: NodeElement = {index: name, data};
        this._processedPart.set(name, node);
        return node;
    }

    private _iterEntry(assetPart: SkinAssetPart): NodeElementGroup[] {
        const elements = this._walk(assetPart, null, false);
        // Group NodeElementSprite and NodeElementData by mask (like Python groupby)
        // This avoids repeated mask checks and stencil update in _renderNode.
        // Not sure if this is idiomatic in TypeScript.
        const groups: NodeElementGroup[] = [];
        let i = 0;
        while (i < elements.length) {
            const key:number|undefined =  (elements[i] as any)?.vertexes?.mask;
            let j = i + 1;
            while (j < elements.length && (elements[i] as any)?.vertexes?.mask === key) j++;
            groups.push(elements.slice(i, j) as NodeElementGroup);
            i = j;
        }
        return groups;
    }

    private _walk(part: SkinAssetPart, transformation: Mat3 | null, assetEqualityCheck: boolean = true): Array<NodeElementData | NodeElementSprite> {
        const result: Array<NodeElementData | NodeElementSprite> = [];
        let index = 0;
        let drawIndex = 0;

        while (index < part.entry.length) {
            const entry = part.entry[index]!;

            if (entry.entries === -1) {
                const vertex = part.skinChunks[drawIndex];
                if (vertex !== undefined) {
                    result.push({transformation: transformation ?? mat3Identity(), vertexes: vertex});
                    drawIndex++;
                }
                index++;
                continue;
            }

            if (entry.symbolId < 0) {
                index++;
                continue;
            }

            const symbolName = part.getSymbolName(entry);
            if (!symbolName || part.name === symbolName) {
                index++;
                continue;
            }

            const [newPart, isCustomised] = this._getSkinCustomAssetPart(symbolName);
            if (newPart === null && !isCustomised) {
                index++;
                continue;
            }

            if (newPart instanceof SkinAssetPart) {
                if (assetEqualityCheck && newPart.source === part.source) {
                    index++;
                    continue;
                }
                const transfo = part.computeTransfo(index, transformation);
                const sub = this._walk(newPart, transfo);
                if (sub.length > 0) result.push(...sub);
            } else if (newPart !== null) {
                const transfo = part.computeTransfo(index, transformation);
                result.push({sprite: newPart.sprite, name: newPart.name, transformation: transfo});
            }

            [index, drawIndex] = part.computeIndexUpdate(index, drawIndex);
        }
        return result;
    }

    abstract getSubEntity(_index: string): DofusSprite|undefined;

    async changeBone(boneName: string): Promise<void> {
        await this._getBone(boneName);
        this.animations = this._getAnimationDict();
        this._dictPartIndex.clear();
        this._dictPartIndexCustom.clear();
        this._dictPart.clear();
        this._processedPart.clear();
    }

    getSymbolNameIndex(symbolName: string | undefined, addIfNotExist = false): number {
        if (!symbolName || !this._customSymbolRef.has(symbolName)) return -1;
        const idx = this.data.exposedNodeNames.indexOf(symbolName);
        if (idx !== -1) return idx;
        if (!addIfNotExist) return -1;
        this.data.exposedNodeNames.push(symbolName);
        return this.data.exposedNodeNames.length - 1;
    }

    customSymbolRefNames(): string[] {
        return [...this._customSymbolRef.keys()]
    }
}
