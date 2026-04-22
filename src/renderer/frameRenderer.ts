import {MaskFlags} from '../readers/renderState';
import type {Look} from '../look/look';
import type {Rectf} from '../data/types';
import type {BufferElement, BufferFrames} from './buffer';
import {MaskRenderer} from './maskRenderer';
import type {RendererContext} from './rendererContext';

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
     * Calculate animation size from data bounds or by scanning all vertex positions.
     * Returns [width, height, offsetX, offsetY].
     */
    getAnimationSize(bounds: Rectf | null, frames: BufferFrames, compute = false): [number, number, number, number] {
        const hasValidBounds = bounds !== null && bounds.width !== null;
        if (!hasValidBounds || (compute && frames.length > 0 && frames[0]!.length > 0)) {
            const empty = frames.every(f => f.length === 0);
            if (empty) return [1, 1, 0, 0];

            let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
            for (const frame of frames) {
                for (const elem of frame) {
                    for (let i = 0; i < elem.nodeElement.length; i++) {
                        const element = elem.nodeElement[i]!;
                        const transfo = elem.transforms[i]!;
                        const corners = element.vertexes.transformedBounds(transfo);
                        if (corners.xMin < xMin) xMin = corners.xMin;
                        if (corners.yMin < yMin) yMin = corners.yMin;
                        if (corners.xMax > xMax) xMax = corners.xMax;
                        if (corners.yMax > yMax) yMax = corners.yMax;
                    }
                }
            }
            return [xMax - xMin, yMax - yMin, xMin, yMin];
        }

        const s = this._look.size;
        return [(bounds.width ?? 1) * s, (bounds.height ?? 1) * s, (bounds.x ?? 0) * s, (bounds.y ?? 0) * s];
    }

    setRenderSize(scale: number, bounds: Rectf | null, frames: BufferFrames, compute = false, forcedSize?: number): void {
        let [w, h, ox, oy] = this.getAnimationSize(bounds, frames, compute);
        if (forcedSize) {
            const minDim = Math.min(w, h);
            if (minDim > 0) scale *= forcedSize / minDim;
        }
        this._openGl.setBound(w, h, ox, oy, scale);
    }

    /**
     * Render one frame to the canvas.
     * Call setRenderSize once before the animation loop, then call renderFrame per tick.
     */
    renderFrame(frames: BufferFrames, frameIndex: number): void {
        const gl = this._openGl.gl;
        const buffer = frames[frameIndex];
        if (!buffer) return;

        this._openGl.clear();
        this.mask.reset();

        for (const elem of buffer) {
            switch (elem.context.maskFlags) {
                case MaskFlags.NONE:
                    gl.disable(gl.STENCIL_TEST);
                    this._renderNode(elem);
                    break
                case MaskFlags.ClearMask:
                case MaskFlags.SetMask:
                    this.mask.renderElement(elem);
                    break
                case MaskFlags.ObeyMask:
                    gl.enable(gl.STENCIL_TEST);
                    gl.stencilFunc(gl.EQUAL, this.mask.count, 0xff);
                    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
                    this._renderNode(elem);
                    break
            }
        }
    }

    private _renderNode(bufferElement: BufferElement): void {
        const ctx = bufferElement.context;
        this._openGl.setupBlendMode(ctx.blendMode);
        this._openGl.setRenderUniforms(ctx.multiplicativeColor, ctx.additiveColor, ctx.customColor, ctx.colorMatrix);

        // I don't know how batch this and keep support for webgl1
        for (let i = 0; i < bufferElement.nodeElement.length; i++) {
            const element = bufferElement.nodeElement[i]!;
            this._openGl.setRenderUniformsPerVertex(element.vertexes.textureId, bufferElement.transforms[i]!);
            element.vertexes.render(this._openGl, this._openGl.program);
        }
    }
}
