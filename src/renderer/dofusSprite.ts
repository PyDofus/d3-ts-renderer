import {getAnimation} from '../data/boneLoader';
import type {Look} from '../look/look';
import type {SubEntityCategory} from '../look/enums';
import {type Directions, flipAnimNameString} from '../data/directions';
import {directionsByAnim, getAnimName, getRelatedChildAnim} from '../data/animation';
import type {AnimationInstance} from '../readers/animationInstance';
import {type Bounds2D, type Mat3, mat3Identity, mat3Scale} from '../math';
import {RenderState} from '../readers/renderState';
import {AssetManager} from './assetManager';
import {Buffer, type BufferFrames, computeBufferLocalBounds} from './buffer';
import {FrameRenderer} from './frameRenderer';
import {RendererContext} from './rendererContext';
import {getAudioManager, type SoundEvent} from '../data/audio';


export const LookChange = {
    /** Nothing requiring a buffer rebuild changed */
    None: 0,
    /** only rebuilds this sprite's buffers + refreshes bounds. */
    Soft: 1,
    /** parent must rebuild its buffers. */
    Structural: 2,
} as const;
export type LookChange = typeof LookChange[keyof typeof LookChange];

export class DofusSprite extends AssetManager {
    readonly parent: DofusSprite | null;
    readonly renderer: FrameRenderer;
    readonly subAnimLoop: boolean;
    readonly numberFrame: number | undefined;
    readonly startFrame: number;

    currentRendering: string | null = null;
    flip = false;

    private _subEntitySprites = new Map<string, DofusSprite>();
    private _animInstances = new Map<string, AnimationInstance>();
    private _animationBuffer = new Map<string, BufferFrames>();
    private _animationBounds = new Map<string, Bounds2D>();

    // store sub animation name to avoid re resolved them
    // (after first prepareAnimation call, currentRendering is set only for main sprite not sub)
    private _subSpriteRenderingName = new Map<string, Map<string, string>>();

    private constructor(
        look: Look,
        openGl: RendererContext,
        parent: DofusSprite | null,
        numberFrame?: number,
        startFrame = 0,
        isAnimMap?: boolean,
        subAnimLoop = true,
    ) {
        super(look, openGl, isAnimMap);
        this.parent = parent;
        this.renderer = new FrameRenderer(openGl, look);
        this.subAnimLoop = subAnimLoop;
        this.numberFrame = numberFrame;
        this.startFrame = startFrame;
    }

    // ── Factory ───────────────────────────────────────────────────────────────────

    /** Create and fully initialise a root DofusSprite. */
    static async create(
        look: Look,
        canvas: HTMLCanvasElement,
        options: {
            boneName?: string;
            numberFrame?: number;
            startFrame?: number;
            isMapAnimation?: boolean,
            subAnimLoop?: boolean
        } = {},
    ): Promise<DofusSprite> {
        const ctx = new RendererContext(canvas);
        ctx.unloadAllTextures();
        const sprite = new DofusSprite(look, ctx, null, options.numberFrame, options.startFrame ?? 0, options.isMapAnimation, options.subAnimLoop);
        await Promise.all([sprite._init(options.boneName), sprite._preloadSubEntities()])
        return sprite;
    }

    /** Internal factory for sub-entities (shares parent's RendererContext). */
    private static async _createChild(look: Look, openGl: RendererContext, parent: DofusSprite, numberFrame?: number): Promise<DofusSprite> {
        const sprite = new DofusSprite(look, openGl, parent, numberFrame, parent.startFrame, parent.isMapAnimation, parent.subAnimLoop);
        await Promise.all([sprite._init(), sprite._preloadSubEntities()])
        return sprite;
    }

    /** Pre-create all sub-entity sprites declared in this look so createSubEntity() works synchronously. */
    private async _preloadSubEntities(): Promise<void> {
        const tasks: Promise<void>[] = [];
        for (const [category, subEntities] of this.look.subEntities) {
            for (const [typeIndex, subLook] of subEntities) {
                const index = DofusSprite.subEntityKey(category, typeIndex);
                tasks.push(this._ensureSubEntity(subLook, index).then(() => undefined));
            }
        }
        await Promise.all(tasks);
    }

    private async _ensureSubEntity(subLook: Look, index: string): Promise<DofusSprite> {
        const existing = this._subEntitySprites.get(index);
        if (existing) return existing;
        const nb = this.subAnimLoop ? this.numberFrame : undefined;
        const sprite = await DofusSprite._createChild(subLook, this.openGl, this, nb);
        this._subEntitySprites.set(index, sprite);
        return sprite;
    }

    // ── Buffer building ───────────────────────────────────────────────────────────

    /**
     * Pre-load the animation .dat,
     * then synchronously build and cache all frame buffers.
     * Returns the cached BufferFrames.
     */
    async buildBuffer(animName: string): Promise<BufferFrames> {
        const cached = this._animationBuffer.get(animName);
        if (cached) return cached;

        const parentTask = this._buildAnimInstance(animName);

        const loadTasks: Promise<unknown>[] = [parentTask];
        for (const [key, subSprite] of this._subEntitySprites) {
            const [childAnim, flip] = getRelatedChildAnim([...subSprite.animations.keys()], animName);
            if (childAnim) {
                this._applySubAnim(subSprite, key, flip, childAnim)
                if (!subSprite._animationBuffer.has(childAnim))
                    loadTasks.push(subSprite.buildBuffer(childAnim).then(() => undefined));
            } else subSprite.currentRendering = null;
        }
        await Promise.all(loadTasks);

        const frames = this._buildBufferSync(animName);
        this._animationBuffer.set(animName, frames);
        this._animationBounds.set(animName, computeBufferLocalBounds(frames));
        return frames;
    }

    private async _buildAnimInstance(animName: string): Promise<AnimationInstance> {
        const cached = this._animInstances.get(animName);
        if (cached) return cached
        if (!this.animations.has(animName)) throw new Error(`Animation '${animName}' not found`);
        const anim = this.animations.get(animName)!;
        const instance = await getAnimation(this.data.m_Name, anim, this.isMapAnimation);
        this._animInstances.set(animName, instance);
        return instance
    }

    private _buildBufferSync(animName: string): BufferFrames {
        const animMeta = this._animInstances.get(animName);
        if (!animMeta) throw new Error(`Animation instance '${animName}' not loaded`);

        const scaleMatrix: Mat3 = mat3Scale(this.look.size);
        const framesBuffer: BufferFrames = [];

        for (const frameNumber of animMeta.iterFrameData(this.numberFrame, this.startFrame)) {
            const buf = new Buffer();
            const stateIter = animMeta.iterRenderStates();
            for (const node of stateIter) {
                const [found, skinPart, isCustomised] = this.getSkinAssetPart(node);
                if (!found) continue
                if (skinPart !== null) {
                    const part = this.processPart(skinPart);
                    buf.appendNode(part, frameNumber, node, scaleMatrix, this.look.flatColorArray);
                }
                if (isCustomised && node.childrenRecursiveCount > 0) {
                    let skip = node.childrenRecursiveCount;
                    while (skip-- > 0) stateIter.next();
                }
            }

            framesBuffer.push(buf);
        }

        return framesBuffer;
    }

    /** Returns pre-built frames (throws if buildBuffer hasn't been called). */
    buffer(animName: string): BufferFrames {
        const frames = this._animationBuffer.get(animName);
        if (!frames) throw new Error(`Frames for '${animName}' not ready. Call buildBuffer first.`);
        return frames;
    }

    getLocalBounds(animName: string): Bounds2D {
        const bounds = this._animationBounds.get(animName);
        if (!bounds) throw new Error(`Bounds for '${animName}' not ready. Call buildBuffer first.`);
        return bounds;
    }

    setupSubAnim(sprite: DofusSprite, key: string): void {
        if (this.currentRendering !== null) {
            const [name, flip] = getRelatedChildAnim([...sprite.animations.keys()], this.currentRendering);
            if (!name) return
            this._applySubAnim(sprite, key, flip, name)
        }
    }

    private _applySubAnim(sprite: DofusSprite, key: string, flip: boolean, name: string) {
        let innerMap = this._subSpriteRenderingName.get(this.currentRendering!);
        if (!innerMap) {
            innerMap = new Map<string, string>();
            this._subSpriteRenderingName.set(this.currentRendering!, innerMap);
        }
        innerMap.set(key, name);

        sprite.currentRendering = name;
        sprite.flip = flip && !this.flip;
    }

    // ── Rendering ─────────────────────────────────────────────────────────────────

    /** Prepare canvas size and pre-build buffers for an animation. */
    async prepareAnimation(animName: string, scale: number, computeBounds: boolean = false, flipX: boolean = false, flipY: boolean = false, forcedSize?: number): Promise<number> {
        if (!this.animations.has(animName)) {
            const flipped = flipAnimNameString(animName)
            if (!this.animations.has(flipped))
                throw new Error(`Animation '${animName}' not found`);
            flipX = true;
            animName = flipped;
        }

        this.flip = flipX;
        this.currentRendering = animName;
        const buffers = await this.buildBuffer(animName);
        const anim = this.animations.get(animName)!;
        this.renderer.setRenderSize(scale, anim.bounds, this.getLocalBounds(animName), computeBounds, forcedSize, flipX, flipY);
        return buffers.length
    }

    resize(scale: number, forcedSize?: number): void {
        if (!this.currentRendering) return;
        const anim = this.animations.get(this.currentRendering);
        if (!anim) return;
        this.renderer.setRenderSize(scale, anim.bounds, this.getLocalBounds(this.currentRendering), true, forcedSize, this.flip, false);
    }

    /** Render a single skin asset (by graphic index or symbol name) to the canvas. */
    renderSkinAsset(graphic: number = -1, symbolName?: string, scale: number = 1.0): void {
        const customIndex = this.getSymbolNameIndex(symbolName, true);
        if (graphic < 0 && customIndex < 0) {
            throw new Error(`You must to define: graphic (0-${this.data.graphics.length - 1}) or symbolName ${this.customSymbolRefNames().join(", ")}`);
        }

        const state = new RenderState();
        state.spriteIndex = graphic;
        state.customisationIndex = customIndex;

        const [found, skinPart] = this.getSkinAssetPart(state);
        if (!found || skinPart === null) {
            throw new Error(`Graphic ${graphic} not found or ${symbolName} not found in the skin asset`);
        }
        const processedPart = this.processPart(skinPart);

        const buffer = new Buffer();
        buffer.appendNode(processedPart, 1, state, mat3Identity(), this.look.flatColorArray);

        const frames: BufferFrames = [buffer];
        this.renderer.setRenderSize(scale, null, computeBufferLocalBounds(frames), true);
        this.renderer.renderFrame(frames, 0);
    }

    /** Render frame `frameIndex` to the canvas. Call prepareAnimation first. */
    renderFrame(frameIndex: number): void {
        if (!this.currentRendering) throw new Error('Call prepareAnimation first.');
        const frames = this.buffer(this.currentRendering);
        this.renderer.renderFrame(frames, frameIndex);
    }

    getFrameCount(animName: string): number {
        return this._animationBuffer.get(animName)?.length ?? 0;
    }

    getAnimName(direction: Directions, name?: string, raise:boolean=true): [string, boolean] {
        return getAnimName([...this.animations.keys()], direction, this.look.bone, name, raise);
    }

    availableDirections(): Record<string, Directions[]> {
        return directionsByAnim(this.animations.keys());
    }

    async getMaxFrame(animName: string): Promise<number> {
        if (!this.animations.has(animName)) return 0;
        const instance = await this._buildAnimInstance(animName);
        const counts: number[] = [instance?.frameCount ?? 0];

        for (const [, subSprite] of this._subEntitySprites) {
            const [childAnim] = getRelatedChildAnim([...subSprite.animations.keys()], animName);
            if (childAnim) counts.push(await subSprite.getMaxFrame(childAnim));
        }
        return Math.max(0, ...counts);
    }

    /**
     * Mutate this sprite to render `newLook`, re-fetching only what changed.
     * Returns the change level so a parent sprite knows whether its own buffers survive.
     */
    async changeLook(newLook: Look, boneName?: string): Promise<LookChange> {
        const boneChanged = newLook.bone !== this.look.bone || (boneName ?? String(newLook.bone) !== this.data.m_Name);
        const skinsChanged = !this.look.sameSkins(newLook);
        const sizeChanged = newLook.size !== this.look.size;
        const tasks: Promise<unknown>[] = [];

        if (sizeChanged) this.look.size = newLook.size;
        if (boneChanged) {
            this.look.bone = newLook.bone;
            tasks.push(this.changeBone(boneName, false).then(() => this._animInstances.clear()));
        }
        if (skinsChanged) tasks.push(this.changeSkins(newLook.skins, false));
        this.look.Color = new Map(newLook.Color);

        const subPromise = this._changeSubEntities(newLook);
        tasks.push(subPromise);
        await Promise.all(tasks);
        const subChange = await subPromise;

        if (boneChanged || skinsChanged || subChange === LookChange.Structural) this._clearCustomCaches();
        const selfChanged = boneChanged || skinsChanged || sizeChanged;
        if (selfChanged || subChange === LookChange.Structural) {
            this._animationBuffer.clear();
            this._animationBounds.clear();
            this._subSpriteRenderingName.clear();
        } else if (subChange === LookChange.Soft) {
            await this._refreshSubBuffers();
        }

        if (this.parent === null) this._sweepStore();
        if (boneChanged) return LookChange.Structural;
        return selfChanged || subChange !== LookChange.None ? LookChange.Soft : LookChange.None;
    }


    private async _refreshSubBuffers(): Promise<void> {
        const tasks: Promise<unknown>[] = [];
        for (const animName of this._animationBuffer.keys()) {
            const mounted = this._subSpriteRenderingName.get(animName);
            if (!mounted) continue;
            for (const [key, childAnim] of mounted) {
                const sprite = this._subEntitySprites.get(key);
                if (sprite && !sprite._animationBuffer.has(childAnim))
                    tasks.push(sprite.buildBuffer(childAnim));
            }
        }
        await Promise.all(tasks);
        for (const [animName, frames] of this._animationBuffer)
            this._animationBounds.set(animName, computeBufferLocalBounds(frames));
    }

    /** Release every store resource not referenced by sprite and sub sprite. */
    private _sweepStore(): void {
        const bones = new Set<string>();
        const skins = new Set<number>();
        this.collectResourceKeys(bones, skins);
        this.openGl.assetStore.sweep(bones, skins);
    }

    override collectResourceKeys(bones: Set<string>, skins: Set<number>): void {
        super.collectResourceKeys(bones, skins);
        for (const sprite of this._subEntitySprites.values()) sprite.collectResourceKeys(bones, skins);
    }

    /**
     * Add/remove/update child sprites to match `newLook`.
     * Returns the strongest change among children: Structural when a child was
     * added/removed or changed bone, Soft when an existing child changed look.
     */
    private async _changeSubEntities(newLook: Look): Promise<LookChange> {
        const desiredKeys = new Set<string>();
        const tasks: Promise<unknown>[] = [];
        let change: LookChange = LookChange.None;

        for (const [category, subEntities] of newLook.subEntities) {
            for (const [typeIndex, subLook] of subEntities) {
                const key = DofusSprite.subEntityKey(category, typeIndex);
                desiredKeys.add(key);
                const existing = this._subEntitySprites.get(key);
                if (existing) {
                    tasks.push(existing.changeLook(subLook).then(c => { if (c > change) change = c; }));
                } else {
                    change = LookChange.Structural;
                    tasks.push(this._ensureSubEntity(subLook, key).then(() => undefined));
                }
            }
        }

        for (const [key] of [...this._subEntitySprites]) {
            if (desiredKeys.has(key)) continue;
            change = LookChange.Structural;
            this._subEntitySprites.delete(key);
        }

        await Promise.all(tasks);
        this.look.subEntities = newLook.subEntities;
        return change;
    }


    override getSubEntity(index: string): DofusSprite | undefined {
        return this._subEntitySprites.get(index);
    }

    private static subEntityKey(category: number, typeIndex: number): string {
        return `carried_${category}_${typeIndex}`;
    }

    getSubEntitySprite(category: SubEntityCategory, typeIndex = 0): DofusSprite | undefined {
        return this._subEntitySprites.get(DofusSprite.subEntityKey(category, typeIndex));
    }

    // ── Audio ─────────────────────────────────────────────────────────────────────

    /** Sound-bank key for the current animation (strip trailing direction index). */
    AnimSoundName(animName: string): string {
        const idx = animName.lastIndexOf('_');
        const baseAnim = idx === -1 ? animName : animName.slice(0, idx);
        return this.look.bone === 1 ? `${this.data.m_Name}/${baseAnim}` : baseAnim;
    }

    /** All [soundName, boneId, sourceFrameCount] tuples for the current anim and sub-entities. */
    currentSoundData(): Array<[string, number, number]> {
        const soundKeys: Array<[string, number, number]> = [];

        const anim = this.currentRendering;
        if (!anim) return soundKeys;

        const instance = this._animInstances.get(anim);
        if (!instance) return soundKeys;

        const nbFrame = instance.frameCount;
        const name = this.AnimSoundName(anim);
        soundKeys.push([name, this.look.bone, nbFrame]);

        const subentity = this._subSpriteRenderingName.get(anim);
        if (!subentity) return soundKeys;
        for (const [index, animName] of subentity) {
            const subSprite = this._subEntitySprites.get(index);
            if (!subSprite) continue;
            subSprite.currentRendering = animName
            soundKeys.push(...subSprite.currentSoundData());
        }
        return soundKeys;
    }

    /** Resolve the current animation's sound events. */
    async currentSoundEvents(): Promise<SoundEvent[]> {
        const keys = this.currentSoundData();
        if (keys.length === 0) return [];
        const manager = await getAudioManager();
        const breedAndSex = await this.look.getBreedAndSex()
        return manager.getSoundAnim(keys, this.data.defaultFrameRate, breedAndSex);
    }
}
