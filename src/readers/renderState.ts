import type {BinaryReader} from './binaryReader';
import {type Color32, emptyFlashFilters, FilterType, type FlashFilters,} from './flashFilters';
import {type Mat3, mat3From, mat3Identity} from '../math';

export const enum NodeState {
    NONE = 0,
    SpriteIndex = 1,
    SpriteOpacity = 2,
    SpriteColorMultiply = 4,
    SpriteColorAdditive = 8,
    Matrix = 16,
    CustomisationIndex = 32,
    Mask = 64,
    ExtendedFilterAndBlendModes = 128,
}

export const enum MaskFlags {
    NONE = 0,
    SetMask = 1,
    ObeyMask = 2,
    ClearMask = 4,
}

export const enum BlendMode {
    Normal = 0,
    Normal_Alternative = 1,
    Layer = 2,
    Multiply = 3,
    Screen = 4,
    Lighten = 5,
    Darken = 6,
    Difference = 7,
    Add = 8,
    Subtract = 9,
    Invert = 10,
    Alpha = 11,
    Erase = 12,
    Overlay = 13,
    Hardlight = 14,
    PreMultiplied = 15,
}

export const enum Filter {
    NONE = 0,
    DropShadowFilter = 1,
    BlurFilter = 2,
    GlowFilter = 4,
    BevelFilter = 8,
    GradientGlowFilter = 16,
    ConvolutionFilter = 32,
    ColorMatrixFilter = 64,
    GradientBevelFilter = 128,
}

export class RenderState {
    tranfoMatrix: Mat3 = mat3Identity();
    spriteIndex = -1;
    customisationIndex = -1;
    childrenRecursiveCount = -1;
    alpha = 1;
    multiplicativeColor: Color32 = [1, 1, 1, 1];
    additiveColor: Color32 = [0, 0, 0, 0];
    maskFlags = 0;
    blendMode = 0;
    colorMatrix: Float32Array | null = null;
    flashFilter: FlashFilters | null = null;

    compute(data: BinaryReader): void {
        const num = data.u8;

        if (num & NodeState.SpriteOpacity) this.alpha = data.u8 / 127;
        data.align(4);

        if (num & (NodeState.SpriteIndex | NodeState.CustomisationIndex)) {
            this.spriteIndex = data.i16;
            this.customisationIndex = data.i16;
            this.childrenRecursiveCount = data.i16;
            data.align(4);
        }

        if (num & NodeState.SpriteColorMultiply) this.multiplicativeColor = data.readRgba();

        if (num & NodeState.SpriteColorAdditive) this.additiveColor = data.readRgba();

        if (num & NodeState.Matrix) {
            this.tranfoMatrix = mat3From(
                data.f32, data.f32, data.f32,
                data.f32, data.f32, data.f32,
                0, 0, 1,
            );
        }

        if (num & NodeState.Mask) {
            this.maskFlags = data.u8;
            data.skip(3);
        }

        if (num & NodeState.ExtendedFilterAndBlendModes) {
            this.flashFilter = emptyFlashFilters();
            this.computeExtendedFilterAndBlendState(data);
        }
    }

    private computeExtendedFilterAndBlendState(data: BinaryReader): void {
        const num = data.u8;
        this.blendMode = data.u8;
        data.skip(2);

        if (num & Filter.ColorMatrixFilter) this.colorMatrix = data.readF32Array(20);

        const filterCount = data.u8;
        for (let i = 0; i < filterCount; i++) {
            const value = data.u8;
            data.align(4);
            if (value & Filter.DropShadowFilter) this.computeDropShadowFilter(data);
            if (value & Filter.BlurFilter) this.computeBlurFilter(data);
            if (value & Filter.GlowFilter) this.computeGlowFilter(data);
        }
        data.align(4);
    }

    private computeBlurFilter(data: BinaryReader): void {
        if (!this.flashFilter) return;
        this.flashFilter.blurFilters.push({blurX: data.f32, blurY: data.f32, numPasses: data.i32});
        this.flashFilter.filterOrder.push(FilterType.Blur);
    }

    private computeGlowFilter(data: BinaryReader): void {
        if (!this.flashFilter) return;
        this.flashFilter.glowFilters.push({
            glowColor: data.readRgba(),
            blurX: data.f32, blurY: data.f32, strength: data.f32,
            inner: data.bool, knockout: data.bool, compositeSource: data.bool,
            numPasses: data.skip(1).u32,
        });
        this.flashFilter.filterOrder.push(FilterType.Glow);
    }

    private computeDropShadowFilter(data: BinaryReader): void {
        if (!this.flashFilter) return;
        this.flashFilter.dropShadowFilters.push({
            dropShadowColor: data.readRgba(),
            blurX: data.f32, blurY: data.f32, angle: data.f32, distance: data.f32, strength: data.f32,
            inner: data.bool, knockout: data.bool, compositeSource: data.bool,
            numPasses: data.skip(1).u32,
        });
        this.flashFilter.filterOrder.push(FilterType.DropShadow);
    }
}
