import {MaskFlags} from '../readers/renderState';
import type {Look} from '../look/look';
import type {Rectf} from '../data/types';
import {type BufferElement, type BufferEntry, type BufferFrames, isSubSpriteRef} from './buffer';
import {MaskRenderer} from './maskRenderer';
import type {RendererContext} from './rendererContext';
import {type Bounds2D, type Mat3, mat3Mul} from '../math';

export class FrameRenderer {
    private readonly _openGl: RendererContext;
    private readonly _look: Look;
    readonly mask: MaskRenderer;

    constructor(openGl: RendererContext, look: Look) {
        this._openGl = openGl;
        this._look = look;
        this.mask = new MaskRenderer(openGl);
    }

    /**
     * compute animation size
     */
    getAnimationSize(bounds: Rectf | null, localBounds: Bounds2D, compute = false): [number, number, number, number] {
        const hasValidBounds = bounds !== null && bounds.width !== null;
        if (!hasValidBounds || compute) {
            if (!isFinite(localBounds.xMin)) return [1, 1, 0, 0];
            return [
                localBounds.xMax - localBounds.xMin,
                localBounds.yMax - localBounds.yMin,
                localBounds.xMin,
                localBounds.yMin,
            ];
        }

        const s = this._look.size;
        return [(bounds.width ?? 1) * s, (bounds.height ?? 1) * s, (bounds.x ?? 0) * s, (bounds.y ?? 0) * s];
    }

    setRenderSize(scale: number, bounds: Rectf | null, localBounds: Bounds2D, compute = false, forcedSize?: number, flipX :boolean = false, flipY: boolean=false): void {
        let [w, h, ox, oy] = this.getAnimationSize(bounds, localBounds, compute);
        if (forcedSize) {
            const maxDim = Math.max(w, h);
            if (maxDim > 0) {
                scale *= forcedSize / maxDim;
                ox -= (maxDim - w) / 2;
                oy -= (maxDim - h) / 2;
                w = maxDim;
                h = maxDim;
            }
        }
        this._openGl.setBound(w, h, ox, oy, scale, flipX, flipY);
    }

    /**
     * Render one frame to the canvas.
     * `frameIndex` is the global tick counter — it is never reset.
     * so each sub-sprite loops at its own period via `frameIndex % subFrames.length`.
     */
    renderFrame(frames: BufferFrames, frameIndex: number): void {
        this._openGl.clear();
        this.mask.reset();
        this._renderEntries(frames, frameIndex, null);
    }

    private _renderEntries(frames: BufferFrames, frameIndex: number, parentTransform: Mat3 | null): void {
        if (frames.length === 0) return;
        const buffer = frames[frameIndex % frames.length];
        if (!buffer) return;

        for (const entry of buffer) {
            this._renderEntry(entry, frameIndex, parentTransform);
        }
    }

    private _renderEntry(entry: BufferEntry, frameIndex: number, parentTransform: Mat3 | null): void {
        if (isSubSpriteRef(entry)) {
            if (frameIndex - entry.emittedAtParentFrame >= entry.maxParentFrame) return;

            const subFrames = entry.subSprite.buffer(entry.subAnimName);
            if (subFrames.length === 0) return;

            const childTransform = parentTransform === null ? entry.transform : mat3Mul(parentTransform, entry.transform);
            this._renderEntries(subFrames, frameIndex, childTransform);
            return;
        }

        switch (entry.context.maskFlags) {
            case MaskFlags.NONE:
                this._openGl.gl.disable(this._openGl.gl.STENCIL_TEST);
                this._renderNode(entry, parentTransform);
                break;
            case MaskFlags.ClearMask:
            case MaskFlags.SetMask:
                this.mask.renderElement(entry, parentTransform);
                break;
            case MaskFlags.ObeyMask:
                this._openGl.gl.enable(this._openGl.gl.STENCIL_TEST);
                this._openGl.gl.stencilFunc(this._openGl.gl.EQUAL, this.mask.count, 0xff);
                this._openGl.gl.stencilOp(this._openGl.gl.KEEP, this._openGl.gl.KEEP, this._openGl.gl.KEEP);
                this._renderNode(entry, parentTransform);
                break;
        }
    }

    private _renderNode(bufferElement: BufferElement, parentTransform: Mat3 | null): void {
        const ctx = bufferElement.context;
        this._openGl.setupBlendMode(ctx.blendMode);
        this._openGl.setRenderUniforms(ctx.multiplicativeColor, ctx.additiveColor, ctx.customColor, ctx.colorMatrix);

        // I don't know how batch this and keep support for webgl1
        for (let i = 0; i < bufferElement.nodeElement.length; i++) {
            const element = bufferElement.nodeElement[i]!;
            const local = bufferElement.transforms[i]!;
            const transfo = parentTransform === null ? local : mat3Mul(parentTransform, local);
            this._openGl.setRenderUniformsPerVertex(element.vertexes.textureId, transfo);
            element.vertexes.render(this._openGl, this._openGl.program);
        }
    }
}
