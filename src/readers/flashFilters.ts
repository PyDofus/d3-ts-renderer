export type Color32 = readonly [number, number, number, number];

export const enum FilterType {
  Blur = 0,
  Glow = 1,
  DropShadow = 2,
  ColorMatrix = 3,
}

export interface BlurFilter {
  blurX: number;
  blurY: number;
  numPasses: number;
}

export interface GlowFilter {
  glowColor: Color32;
  blurX: number;
  blurY: number;
  strength: number;
  inner: boolean;
  knockout: boolean;
  compositeSource: boolean;
  numPasses: number;
}

export interface DropShadowFilter {
  dropShadowColor: Color32;
  blurX: number;
  blurY: number;
  angle: number;
  distance: number;
  strength: number;
  inner: boolean;
  knockout: boolean;
  compositeSource: boolean;
  numPasses: number;
}

export interface FlashFilters {
  filterOrder: FilterType[];
  blurFilters: BlurFilter[];
  glowFilters: GlowFilter[];
  dropShadowFilters: DropShadowFilter[];
  colorMatrices: Float32Array[];
}

export function emptyFlashFilters(): FlashFilters {
  return {
    filterOrder: [],
    blurFilters: [],
    glowFilters: [],
    dropShadowFilters: [],
    colorMatrices: [],
  };
}