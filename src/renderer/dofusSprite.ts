import {getAnimation} from '../data/boneLoader';
import type {Look} from '../look/look';
import {type Directions, flipAnimNameString} from '../data/directions';
import {getAnimName, getRelatedChildAnim} from '../data/animation';
import type {AnimationInstance} from '../readers/animationInstance';
import {type Bounds2D, type Mat3, mat3Identity, mat3Scale} from '../math';
import {RenderState} from '../readers/renderState';
import {AssetManager} from './assetManager';
import {Buffer, type BufferFrames, computeBufferLocalBounds} from './buffer';
import {FrameRenderer} from './frameRenderer';
import {RendererContext} from './rendererContext';
import {getAudioManager, type SoundEvent} from '../data/audio';

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
        isAnimMap?:boolean,
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
        options: { boneName?: string; numberFrame?: number; startFrame?: number; isMapAnimation?: boolean, subAnimLoop?: boolean} = {},
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
                const index = `carried_${category}_${typeIndex}`;
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
                if (!subSprite._animInstances.has(childAnim))
                    loadTasks.push(subSprite.buildBuffer(childAnim).then(() => undefined));
            }
            else subSprite.currentRendering = null;
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
                if (found && skinPart !== null) {
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

    setupSubAnim(sprite: DofusSprite, key:string): void {
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
    async prepareAnimation(animName: string, scale: number, computeBounds:boolean = false, flipX: boolean = false, flipY: boolean=false, forcedSize?: number): Promise<number> {
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

    /** Render a single skin asset (by graphic index or symbol name) to the canvas. */
    renderSkinAsset(graphic: number = -1, symbolName?: string, scale: number = 1.0): void {
        const customIndex = this.getSymbolNameIndex(symbolName, true);
        if (graphic < 0 && customIndex < 0) {
            throw new Error(`You must to define: graphic (0-${this.data.graphics.length-1}) or symbolName ${this.customSymbolRefNames().join(", ")}`);
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

    getAnimName(direction: Directions, name?: string): [string, boolean] {
        return getAnimName([...this.animations.keys()], direction, this.look.bone, name);
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

    override getSubEntity(index: string): DofusSprite|undefined {
        return this._subEntitySprites.get(index);
    }

    // ── Audio ─────────────────────────────────────────────────────────────────────

    /** Sound-bank key for the current animation (strip trailing direction index). */
    AnimSoundName(animName:string): string {
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
        return manager.getSoundAnim(keys, this.data.defaultFrameRate);
    }
}
