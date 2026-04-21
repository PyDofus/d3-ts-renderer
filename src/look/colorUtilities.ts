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
