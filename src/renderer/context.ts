import type {RenderState} from '../readers/renderState.js';
import {type Mat3, mat3Mul} from '../math.js';

/** Immutable per-draw-call state snapshot (replaces Python's Context dataclass). */
export interface RenderContext {
    readonly multiplicativeColor: readonly [number, number, number, number];
    readonly additiveColor: readonly [number, number, number, number];
    readonly tranfoMatrix: Mat3;
    readonly blendMode: number;
    readonly alpha: number;
    readonly maskFlags: number;
    readonly customColor: Float32Array;
    readonly colorMatrix: Float32Array | null;
}

export function renderContextFromState(
    state: RenderState,
    scaleMatrix: Mat3,
    customColor: Float32Array,
): RenderContext {
    return {
        multiplicativeColor: state.multiplicativeColor,
        additiveColor: state.additiveColor,
        tranfoMatrix: mat3Mul(scaleMatrix, state.tranfoMatrix),
        blendMode: state.blendMode,
        alpha: state.alpha,
        maskFlags: state.maskFlags,
        customColor,
        colorMatrix: state.colorMatrix,
    };
}

export function renderContextWithMatrix(ctx: RenderContext, tranfoMatrix: Mat3): RenderContext {
    return {...ctx, tranfoMatrix};
}
