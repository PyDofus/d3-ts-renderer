import {type RenderState} from '../readers/renderState';
import {type RenderContext, renderContextFromState, renderContextWithMatrix} from './context';
import {type Mat3, mat3FlipX, mat3Mul, mat3Translation} from '../math';
import {
    isDataGroup,
    isSpriteGroup,
    type NodeElement,
    type NodeElementData,
    type NodeElementSprite
} from './nodeStructure';

export interface BufferElement {
    readonly context: RenderContext;
    readonly nodeElement: readonly NodeElementData[];
    readonly transforms: readonly Mat3[];
}

function computeTransforms(ctx: RenderContext, elements: readonly NodeElementData[]): readonly Mat3[] {
    return elements.map(e => mat3Mul(ctx.tranfoMatrix, e.transformation));
}

export function makeBufferElement(ctx: RenderContext, elements: readonly NodeElementData[]): BufferElement {
    const transforms = computeTransforms(ctx, elements);
    return {context: ctx, nodeElement: elements, transforms};
}

export type BufferFrames = Buffer[];

export class Buffer extends Array<BufferElement> {
    appendNode(node: NodeElement, frameNb: number, state: RenderState, scaleMatrix: Mat3, customColor: Float32Array): void {
        for (const group of node.data) {
            if (isDataGroup(group)) {
                const ctx = renderContextFromState(state, scaleMatrix, customColor);
                this.push(makeBufferElement(ctx, group));
            } else if (isSpriteGroup(group)) {
                for (const spriteNode of group) {
                    this._appendSprite(spriteNode, frameNb, state.tranfoMatrix);
                }
            }
        }
    }

    private _appendSprite(node: NodeElementSprite, frameNb: number, transfo: Mat3): void {
        if (!node.sprite.parent) return;
        const parent = node.sprite.parent;

        if (!node.sprite.currentRendering) {
            parent.setupSubAnim(node.sprite);
            if (!node.sprite.currentRendering) return;
        }

        const frames = node.sprite.buffer(node.sprite.currentRendering);

        // Don't loop if the sub-animation is finished and looping is disabled.
        if (!node.sprite.subAnimLoop && frameNb >= frames.length) return;

        // Scale + offset matrix combining parent look size and transfo translation.
        const scaleWithOffset = mat3Translation(transfo, parent.look.size);
        let transfoMatrix = node.transformation === null ? scaleWithOffset : mat3Mul(scaleWithOffset, node.transformation);
        if (node.sprite.flip) mat3FlipX(transfoMatrix)

        const frame = frames[frameNb % frames.length];
        if (!frame) return;
        for (const elem of frame) {
            const newTransfo = mat3Mul(transfoMatrix, elem.context.tranfoMatrix);
            const newCtx = renderContextWithMatrix(elem.context, newTransfo);
            this.push({
                context: newCtx,
                nodeElement: elem.nodeElement,
                transforms: elem.transforms.map(t => mat3Mul(transfoMatrix, t))
            });
        }
    }
}
