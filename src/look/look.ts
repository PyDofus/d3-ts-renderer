import {
    arrayColorsToDict,
    dictToIndexedColors,
    dictToMountColor,
    indexedColorsToDict,
    parseLookStringColor,
    type RGB,
    rgbToInt
} from './colorUtilities';
import {SubEntityCategory} from './enums';
import type {BodyData} from "../data/types";
import {getBodies} from "../data/body";
import {getEnumKeyByValue} from "../utilities";
import {getBreeds} from "../data/breed";

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
    readonly flatColorArray = new Float32Array(48);

    private static readonly numberBaseDict: Readonly<Record<string, number>> = {A: 10, G: 16, Z: 36};

    constructor(bone: number, skins: number[] = [], color: Map<number, RGB> = new Map(), size = 1) {
        this.bone = bone;
        this.skins = skins;
        this.color = color;
        this.size = size;
        this.subEntities = new Map<number, Map<number, Look>>();
        this.writeFlat();
    }

    set Color(map: Map<number, RGB>) {
        this.color = new Map(map);
        this.writeFlat();
    }

    get Color(): ReadonlyMap<number, RGB> {
        return this.color
    }

    setColor(index: number, value: RGB) {
        this.color.set(index, value);
        if (index < 0 || index >= 16) return;
        this.flatColorArray[index * 3] = value[0];
        this.flatColorArray[index * 3 + 1] = value[1];
        this.flatColorArray[index * 3 + 2] = value[2];
    }

    private writeFlat(): void {
        for (let i = 0; i < 16; i++) {
            const c = this.color.get(i) ?? [1, 1, 1];
            this.flatColorArray[i * 3] = c[0];
            this.flatColorArray[i * 3 + 1] = c[1];
            this.flatColorArray[i * 3 + 2] = c[2];
        }
    }

    getPetColor(indexedColors?: readonly number[]): Map<number, RGB> {
        return new Map([...this.color, ...indexedColorsToDict(indexedColors)]);
    }

    getRideableColor(isMount: boolean, kramelehone: boolean, indexedColors?: readonly number[]): Map<number, RGB> {
        const color = indexedColorsToDict(indexedColors);
        if (isMount && !kramelehone) return color;
        const riderColor = dictToMountColor(this.color);
        return isMount ? new Map([...color, ...riderColor]) : new Map([...riderColor, ...color]);
    }

    get riderLook(): Look {
        return this.subEntities.get(SubEntityCategory.MOUNT_DRIVER)?.get(0) ?? this;
    }

    get petLook(): Look | undefined {
        return this.subEntities.get(SubEntityCategory.PET)?.get(0);
    }

    setSubEntity(category: SubEntityCategory, subLook: Look, index: number = 0) {
        let categoryEntities = this.subEntities.get(category);
        if (!categoryEntities) {
            categoryEntities = new Map();
            this.subEntities.set(category, categoryEntities);
        }
        categoryEntities.set(index, subLook);
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
        const [boneStr, skinsStr, colorStr, sizeStr, ...subEntitiesStrSplit] = stripped.split('|');
        const subEntitiesStr = subEntitiesStrSplit.join("|")

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

    static async fromStringAsync(lookString: string, injectColor: boolean = false, numberBase = 10): Promise<Look> {
        const look = Look.fromString(lookString, numberBase)
        if (injectColor) await look.injectColor()
        return look
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

    static parseConditionalLooks(lookString: string): Array<{ look: string; index: number; condition: string }> {
        return lookString
            .split(',{')
            .map(s => {
                const clean = s.endsWith('}') ? s.slice(0, -1) : s
                const looks = clean.startsWith('{') ? clean : '{' + clean
                const [look, conditions] = looks.split('$');
                const parts = conditions!.split(';');
                return {look: `${look}}`, index: Number(parts[0]), condition: parts[parts.length - 1]!};
            });
    }

    async injectColor(): Promise<void> {
        if (this.color.size < 6) {
            const body = await this.getBody();
            if (body) {
                const breeds = await getBreeds()
                const breed = breeds.data.get(body.breed)
                if (breed) {
                    const colors = (body.gender == 1) ? breed.femaleColors : breed.maleColors;
                    const colorsMap = arrayColorsToDict(colors);
                    for (const [index, color] of colorsMap) {
                        if (!this.color.has(index)) this.setColor(index, color);
                    }
                }
            }
        }

        for (const subEntityMap of this.subEntities.values()) {
            for (const subEntity of subEntityMap.values()) {
                await subEntity.injectColor()
            }
        }
    }

    async getBody(): Promise<BodyData | undefined> {
        if (this.skins.length == 0) return undefined
        const bodies = await getBodies();
        return bodies.skinMapping.get(this.skins[0]!)
    }

    async getBreedAndSex(): Promise<number | undefined> {
        const body = await this.getBody();
        if (body) return 2 * body.breed + body.gender;
    }

    toB16String(): string {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(this.toString());
        const hexArray = new Array(bytes.length);

        for (let i = 0; i < bytes.length; i++)
            hexArray[i] = bytes[i]!.toString(16).padStart(2, '0');
        return hexArray.join('');
    }

    toDict(): LookDict {
        const subEntities: SubEntityLookDict[] = [];
        for (const [category, subEntityMap] of this.subEntities) {
            for (const subEntity of subEntityMap.values())
                subEntities.push({
                    bindingPointCategory: getEnumKeyByValue(SubEntityCategory, category as SubEntityCategory) ?? 'UNUSED',
                    subEntityLook: subEntity.toDict()
                })
        }

        return {
            bonesId: this.bone,
            skins: this.skins,
            scales: [Math.floor(this.size * 100)],
            indexedColors: dictToIndexedColors(this.color),
            subEntities: subEntities
        }
    }

    /** Deep structural copy: exact colors, size, bone and sub-entity category/index keys preserved. */
    clone(): Look {
        const copy = new Look(
            this.bone,
            [...this.skins],
            new Map(this.color),
            this.size,
        );
        for (const [category, subMap] of this.subEntities) {
            const catCopy = new Map<number, Look>();
            for (const [index, sub] of subMap) catCopy.set(index, sub.clone());
            copy.subEntities.set(category, catCopy);
        }
        return copy;
    }

    toString(): string {
        const components: string[] = [
            this.bone ? String(this.bone) : '',
            this.skins.map(skin => String(skin)).join(','),
            Array.from(this.color, ([i, color]) => `${i}=${rgbToInt(color)}`).join(','),
            String(Math.floor(this.size * 100))];

        if (this.subEntities) {
            const subEntities: string[] = [];
            for (const [category, subEntityDict] of this.subEntities) {
                for (const [index, subEntity] of subEntityDict) {
                    subEntities.push(`${category}@${index}=${subEntity.toString()}`);
                }
            }
            components.push(subEntities.join(''));
        }

        return `{${components.join('|')}}`;
    }

    sameSkins(otherLook: Look): boolean {
        if (this.skins.length !== otherLook.skins.length) return false;
        const skins = [...this.skins].sort((x, y) => x - y);
        const otherSkins = [...otherLook.skins].sort((x, y) => x - y);
        return skins.every((val, i) => val === otherSkins[i]);
    }
}
