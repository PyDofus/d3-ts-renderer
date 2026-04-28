import {type RenderState} from '../readers/renderState';
import {type RenderContext, renderContextFromState} from './context';
import {type Bounds2D, type Mat3, mat3FlipX, mat3Mul, mat3Translation, transformAABB} from '../math';
import {
    isDataGroup,
    isSpriteGroup,
    type NodeElement,
    type NodeElementData,
    type NodeElementSprite
} from './nodeStructure';
import type {DofusSprite} from './dofusSprite';

export interface BufferElement {
    readonly context: RenderContext;
    readonly nodeElement: readonly NodeElementData[];
    readonly transforms: readonly Mat3[];
}

/**
 * Reference to a sub-sprite occurrence in a parent frame.
 */
export interface BufferSubSpriteRef {
    readonly subSprite: DofusSprite;
    readonly subAnimName: string;
    readonly transform: Mat3;
    /** When subAnimLoop is false, sub stops after this many parent frames since the marker was emitted. */
    readonly maxParentFrame: number;
    readonly emittedAtParentFrame: number;
}

export type BufferEntry = BufferElement | BufferSubSpriteRef;

export function isSubSpriteRef(entry: BufferEntry): entry is BufferSubSpriteRef {
    return (entry as BufferSubSpriteRef).subSprite !== undefined;
}

function computeTransforms(ctx: RenderContext, elements: readonly NodeElementData[]): readonly Mat3[] {
    return elements.map(e => mat3Mul(ctx.tranfoMatrix, e.transformation));
}

export function makeBufferElement(ctx: RenderContext, elements: readonly NodeElementData[]): BufferElement {
    const transforms = computeTransforms(ctx, elements);
    return {context: ctx, nodeElement: elements, transforms};
}

export type BufferFrames = Buffer[];

export class Buffer extends Array<BufferEntry> {
    appendNode(node: NodeElement, frameNb: number, state: RenderState, scaleMatrix: Mat3, customColor: Float32Array): void {
        for (const group of node.data) {
            if (isDataGroup(group)) {
                const ctx = renderContextFromState(state, scaleMatrix, customColor, group[0]!.vertexes.mask);
                this.push(makeBufferElement(ctx, group));
            } else if (isSpriteGroup(group)) {
                for (const spriteNode of group) {
                    this._appendSprite(spriteNode, frameNb, state.tranfoMatrix);
                }
            }
        }
    }

    private _appendSprite(node: NodeElementSprite, frameNb: number, transfo: Mat3): void {
        const subSprite = node.sprite;
        if (!subSprite.parent) return;
        const parent = subSprite.parent;

        if (!subSprite.currentRendering) {
            parent.setupSubAnim(subSprite, node.name);
            if (!subSprite.currentRendering) return;
        }


        const scaleWithOffset = mat3Translation(transfo, parent.look.size);
        let transformMatrix = node.transformation === null ? scaleWithOffset : mat3Mul(scaleWithOffset, node.transformation);
        if (subSprite.flip) mat3FlipX(transformMatrix);

        const maxParentFrame = subSprite.subAnimLoop ? Number.POSITIVE_INFINITY : subSprite.buffer(subSprite.currentRendering).length;

        const ref: BufferSubSpriteRef = {
            subSprite,
            subAnimName: subSprite.currentRendering,
            transform: transformMatrix,
            maxParentFrame,
            emittedAtParentFrame: frameNb,
        };
        this.push(ref);
    }
}

/**
 * Recursively compute the union AABB enclosing every drawable pixel across all frames
 */
export function computeBufferLocalBounds(frames: BufferFrames): Bounds2D {
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;

    for (const frame of frames) {
        for (const entry of frame) {
            if (isSubSpriteRef(entry)) {
                const local = entry.subSprite.getLocalBounds(entry.subAnimName);
                if (!isFinite(local.xMin)) continue;
                const aabb = transformAABB(local, entry.transform);
                if (aabb.xMin < xMin) xMin = aabb.xMin;
                if (aabb.yMin < yMin) yMin = aabb.yMin;
                if (aabb.xMax > xMax) xMax = aabb.xMax;
                if (aabb.yMax > yMax) yMax = aabb.yMax;
                continue;
            }
            for (let i = 0; i < entry.nodeElement.length; i++) {
                const corners = entry.nodeElement[i]!.vertexes.transformedBounds(entry.transforms[i]!);
                if (corners.xMin < xMin) xMin = corners.xMin;
                if (corners.yMin < yMin) yMin = corners.yMin;
                if (corners.xMax > xMax) xMax = corners.xMax;
                if (corners.yMax > yMax) yMax = corners.yMax;
            }
        }
    }

    return {xMin, yMin, xMax, yMax};
}
