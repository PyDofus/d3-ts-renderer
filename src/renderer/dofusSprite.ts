import {getAnimation} from '../data/boneLoader';
import type {Look} from '../look/look';
import {type Directions} from '../data/directions';
import {getAnimName, getRelatedChildAnim} from '../data/animation';
import type {AnimationInstance} from '../readers/animationInstance';
import {type Mat3, mat3Scale} from '../math';
import {AssetManager} from './assetManager';
import {Buffer, type BufferFrames} from './buffer';
import {FrameRenderer} from './frameRenderer';
import {RendererContext} from './rendererContext';

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

    private constructor(
        look: Look,
        openGl: RendererContext,
        parent: DofusSprite | null,
        numberFrame?: number,
        startFrame = 0,
        subAnimLoop = true,
    ) {
        super(look, openGl);
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
        options: { boneName?: string; numberFrame?: number; startFrame?: number } = {},
    ): Promise<DofusSprite> {
        const ctx = new RendererContext(canvas);
        ctx.unloadAllTextures();
        const sprite = new DofusSprite(look, ctx, null, options.numberFrame, options.startFrame ?? 0);
        await sprite._init(options.boneName);
        await sprite._preloadSubEntities();
        return sprite;
    }

    /** Internal factory for sub-entities (shares parent's RendererContext). */
    private static async _createChild(look: Look, openGl: RendererContext, parent: DofusSprite, numberFrame?: number): Promise<DofusSprite> {
        const sprite = new DofusSprite(look, openGl, parent, numberFrame, 0, parent.subAnimLoop);
        await sprite._init();
        await sprite._preloadSubEntities();
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

        await this._buildAnimInstance(animName);

        const childLoadTasks: Promise<void>[] = [];
        for (const [, subSprite] of this._subEntitySprites) {
            const [childAnim] = getRelatedChildAnim([...subSprite.animations.keys()], animName);
            if (childAnim && !subSprite._animInstances.has(childAnim)) {
                childLoadTasks.push(subSprite.buildBuffer(childAnim).then(() => undefined));
            }
        }
        await Promise.all(childLoadTasks);

        const frames = this._buildBufferSync(animName);
        this._animationBuffer.set(animName, frames);
        return frames;
    }

    private async _buildAnimInstance(animName: string): Promise<AnimationInstance> {
        const cached = this._animInstances.get(animName);
        if (cached) return cached
        if (!this.animations.has(animName)) throw new Error(`Animation '${animName}' not found`);
        const anim = this.animations.get(animName)!;
        const instance = await getAnimation(this.data.m_Name, anim);
        this._animInstances.set(animName, instance);
        return instance
    }

    private _buildBufferSync(animName: string): BufferFrames {
        const animMeta = this._animInstances.get(animName);
        if (!animMeta) throw new Error(`Animation instance '${animName}' not loaded`);

        this.currentRendering = animName;
        this.resetSubSpriteCurrentRendering()
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

    setupSubAnim(sprite: DofusSprite): void {
        if (this.currentRendering !== null) {
            const [name, flip] = getRelatedChildAnim([...sprite.animations.keys()], this.currentRendering);
            sprite.currentRendering = name ?? null;
            sprite.flip = flip;
        }
    }

    // ── Rendering ─────────────────────────────────────────────────────────────────

    /** Prepare canvas size and pre-build buffers for an animation. */
    async prepareAnimation(animName: string, scale: number, computeBounds = false, forcedSize?: number,): Promise<void> {
        const buffers = await this.buildBuffer(animName);
        this.currentRendering = animName;
        const anim = this.animations.get(animName)!;
        this.renderer.setRenderSize(scale, anim.bounds, buffers, computeBounds, forcedSize);
    }

    /** Render frame `frameIndex` to the canvas. Call prepareAnimation first. */
    renderFrame(frameIndex: number): void {
        if (!this.currentRendering) throw new Error('Call prepareAnimation first.');
        const frames = this.buffer(this.currentRendering);
        this.renderer.renderFrame(frames, frameIndex % frames.length);
    }

    getFrameCount(animName: string): number {
        return this._animationBuffer.get(animName)?.length ?? 0;
    }

    getAnimName(direction: Directions, name?: string): [string, boolean] {
        return getAnimName([...this.animations.keys()], direction, this.look.bone, name);
    }

    resetSubSpriteCurrentRendering(): void {
        for (const sprite of this._subEntitySprites.values()) {
            sprite.currentRendering = null;
            sprite.resetSubSpriteCurrentRendering();
        }
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

    override getSubEntity(subLook: Look, index: string): DofusSprite {
        const existing = this._subEntitySprites.get(index);
        if (existing) return existing;
        throw new Error(`Sub-entity '${index}' not pre-loaded. This is a bug.`);
    }
}
