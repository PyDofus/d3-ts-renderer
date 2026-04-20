import {indexedColorsToDict, parseLookStringColor, type RGB} from './colorUtilities';
import {SubEntityCategory} from './enums';
import type {BodyData} from "../data/types";
import {getBodies} from "../data/body";

export interface LookDict {
    bonesId: number;
    skins?: number[];
    scales?: number[];
    indexedColors?: number[];
    subEntities?: SubEntityLookDict[];
}

export interface SubEntityLookDict {
    bindingPointCategory: keyof typeof SubEntityCategory;
    subEntityLook: LookDict;
}

export class Look {
    bone: number;
    skins: number[];
    size: number;
    subEntities: Map<number, Map<number, Look>>;

    private color: Map<number, RGB>;
    private _flatColorArray?: Float32Array;

    private static readonly numberBaseDict: Readonly<Record<string, number>> = {A: 10, G: 16, Z: 36};

    constructor(bone: number, skins: number[] = [], color: Map<number, RGB> = new Map(), size = 1) {
        this.bone = bone;
        this.skins = skins;
        this.color = color;
        this.size = size;
        this.subEntities = new Map<number, Map<number, Look>>();
    }

    set Color(map: Map<number, RGB>) {
        this.color = new Map(map);
        this._flatColorArray = undefined;
    }

    get Color(): ReadonlyMap<number, RGB> {
        return this.color
    }

    setColor(index: number, value: RGB) {
        this.color.set(index, value);
        this._flatColorArray = undefined;
    }

    get flatColorArray(): Float32Array {
        if (!this._flatColorArray) this._flatColorArray = this.computeFlat();
        return this._flatColorArray;
    }

    private computeFlat(): Float32Array {
        const flat = new Float32Array(48);
        for (let i = 0; i < 16; i++) {
            const c = this.color.get(i) ?? [1, 1, 1];
            flat[i * 3] = c[0];
            flat[i * 3 + 1] = c[1];
            flat[i * 3 + 2] = c[2];
        }
        return flat;
    }

    static fromString(lookString: string, numberBase = 10): Look {
        let s = lookString;
        let base = numberBase;

        if (s.startsWith('[')) {
            const closeBracket = s.indexOf(']');
            const header = s.slice(1, closeBracket);
            s = s.slice(closeBracket + 1);
            const headerParts = header.split(',');
            base = Look.numberBaseDict[headerParts[1] ?? ''] ?? 10;
        }

        if (s.includes(',{')) s = Look.extractDefaultConditionalLook(s);

        const inner = s.startsWith('{') ? s.slice(1) : s;
        const stripped = inner.endsWith('}') ? inner.slice(0, -1) : inner;
        const [boneStr, skinsStr, colorStr, sizeStr, subEntitiesStr] = stripped.split('|');

        const bone = boneStr ? parseInt(boneStr ?? '0', base) : 0;
        const skins = skinsStr ? skinsStr.split(',').map(i => parseInt(i, base)) : [];
        const color = colorStr ? parseLookStringColor(colorStr, base) : new Map();
        const size = sizeStr ? parseInt(sizeStr, base) / 100 : 1;

        const look = new Look(bone, skins, color, size)

        if (subEntitiesStr) {
            const rawSubEntities = subEntitiesStr.endsWith('}') ? subEntitiesStr.slice(0, -1) : subEntitiesStr
            for (const chunk of rawSubEntities.split('}')) {
                const cleanedChunk = chunk.startsWith(",") ? chunk.slice(1) : chunk
                const eqIdx = cleanedChunk.indexOf('=');
                const header2 = cleanedChunk.slice(0, eqIdx);
                const body = cleanedChunk.slice(eqIdx + 1) + "}";
                const atIdx = header2.indexOf('@');
                const category = parseInt(header2.slice(0, atIdx), base);
                const bindingIndex = parseInt(header2.slice(atIdx + 1), base);
                const subLook = Look.fromString(body);
                let catMap = look.subEntities.get(category);
                if (!catMap) {
                    catMap = new Map();
                    look.subEntities.set(category, catMap);
                }
                catMap.set(bindingIndex, subLook);
            }
        }
        return look;
    }

    static fromDict(lookDict: LookDict): Look {
        const look = new Look(
            lookDict.bonesId,
            lookDict.skins ? [...lookDict.skins] : [],
            indexedColorsToDict(lookDict.indexedColors),
            (lookDict.scales?.[0] ?? 100) / 100,
        );

        for (const sub of lookDict.subEntities ?? []) {
            const category = SubEntityCategory[sub.bindingPointCategory as keyof typeof SubEntityCategory] ?? 0;
            let catMap = look.subEntities.get(category);
            if (!catMap) {
                catMap = new Map();
                look.subEntities.set(category, catMap);
            }
            const index = catMap.size;
            catMap.set(index, Look.fromDict(sub.subEntityLook));
        }

        return look;
    }

    static fromB16String(hex: string): Look {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
        }
        return Look.fromString(new TextDecoder().decode(bytes));
    }

    private static extractDefaultConditionalLook(lookString: string): string {
        const conditionalLook = lookString.split(',{').map(s => (s.endsWith('}') ? s.slice(0, -1) : s).split('$'));
        const found = conditionalLook.find(i => i[1]!.endsWith(';'));
        return found ? found[0]! : conditionalLook[0]![0]!;
    }

    async getBody(): Promise<BodyData | undefined> {
        if (this.skins.length == 0) return undefined
        const bodies = await getBodies();
        return bodies.skinMapping.get(this.skins[0]!)
    }

}
