export type RGB = readonly [number, number, number];

export function intToRgb(value: number, divide = 127): RGB {
    return [((value >> 16) & 0xff) / divide, ((value >> 8) & 0xff) / divide, (value & 0xff) / divide];
}

export function rgbToInt(rgb: RGB | undefined): number {
    if (!rgb) return 0;
    return (Math.trunc(rgb[0] * 127) << 16) | (Math.trunc(rgb[1] * 127) << 8) | Math.trunc(rgb[2] * 127);
}

export function indexedColorsToDict(indexedColors: readonly number[] | undefined): Map<number, RGB> {
    if (!indexedColors) return new Map();
    const result = new Map<number, RGB>();
    for (const i of indexedColors)
        result.set((i >>> 24) & 0xff, intToRgb(i));
    return result;
}

export function dictToIndexedColors(colorDict: Map<number, RGB>): number[] {
  const result: number[] = new Array(colorDict.size);
  let i = 0;
  for (const [key, value] of colorDict)
    result[i++] = (key << 24) | rgbToInt(value);
  return result;
}

export function arrayColorsToDict(arrayColors: number[]): Map<number, RGB> {
    return new Map(arrayColors.map((c, index) => [index + 1, intToRgb(c)]));
}

const RIDER_MOUNT_INDICES = [3, 4, 5, 6] as const;

export function dictToMountColor(colorDict: Map<number, RGB>): Map<number, RGB> {
    const result = new Map<number, RGB>();
    RIDER_MOUNT_INDICES.forEach((riderIndex, position) => {
        const value = colorDict.get(riderIndex);
        if (value) result.set(position + 1, value);
    });
    return result;
}

/** Mount color index that a rider color index drives, or undefined if it doesn't map. */
export function riderToMountIndex(riderIndex: number): number | undefined {
    const position = RIDER_MOUNT_INDICES.indexOf(riderIndex as typeof RIDER_MOUNT_INDICES[number]);
    return position === -1 ? undefined : position + 1;
}

export function indexedColorIndices(indexedColors?: readonly number[]): Set<number> {
    return new Set(indexedColorsToDict(indexedColors).keys());
}

export function mergeIndexedColors(target: Map<number, RGB>, indexedColors?: readonly number[]): void {
    for (const [index, rgb] of indexedColorsToDict(indexedColors)) target.set(index, rgb);
}

export function parseLookStringColor(value: string, base = 10): Map<number, RGB> {
    const result = new Map<number, RGB>();
    for (const item of value.split(',')) {
        const parts = item.split('=');
        if (parts.length !== 2) continue;
        const idx = parseInt(parts[0]!, base);
        const raw = parts[1]!;
        const colorVal = raw.startsWith('#') ? parseInt(raw.slice(1), 16) : parseInt(raw, base);
        result.set(idx, intToRgb(colorVal));
    }
    return result;
}
