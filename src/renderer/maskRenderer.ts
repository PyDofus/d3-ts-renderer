import {MaskFlags} from '../readers/renderState.js';
import type {RendererContext} from './rendererContext.js';
import type {BufferElement} from './buffer.js';
import type {NodeElementData} from './nodeStructure.js';
import type {Mat3} from '../math.js';

export class MaskRenderer {
    private readonly _ctx: RendererContext;
    count = 0;

    constructor(ctx: RendererContext) {
        this._ctx = ctx;
    }

    reset(): void {
        this.count = 0;
    }

    renderElement(bufferElement: BufferElement): void {
        this._setup(bufferElement.context.maskFlags);
        for (let i = 0; i < bufferElement.nodeElement.length; i++) {
            const elem = bufferElement.nodeElement[i]!;
            const transfo = bufferElement.transforms[i]!;
            this._ctx.setMaskTransfo(transfo, elem.vertexes.textureId);
            elem.vertexes.render(this._ctx, this._ctx.maskProgram);
        }
        this._disable();
    }

    render(element: NodeElementData, transfo: Mat3): void {
        this._setup(element.vertexes.mask);
        this._ctx.setMaskTransfo(transfo, element.vertexes.textureId);
        element.vertexes.render(this._ctx, this._ctx.maskProgram);
        this._disable();
    }

    private _setup(mask: number): void {
        const gl = this._ctx.gl;
        gl.disable(gl.BLEND);
        gl.enable(gl.STENCIL_TEST);
        gl.colorMask(false, false, false, false);

        if (mask === MaskFlags.SetMask) {
            gl.stencilFunc(gl.ALWAYS, 0, 0xff);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
            this.count++;
        } else {
            gl.stencilFunc(gl.ALWAYS, 0, 0xff);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.DECR);
            this.count--;
        }
    }

    private _disable(): void {
        const gl = this._ctx.gl;
        gl.colorMask(true, true, true, true);
        gl.enable(gl.BLEND);
    }
}
