import type {BodyData} from "./types";
import {getLoader} from "./loader";


export class Body {
    readonly data: Map<number, BodyData>;
    readonly skinMapping: Map<number, BodyData>

    private constructor(data: Record<string, BodyData>) {
        this.data = new Map<number, BodyData>();
        for (const value of Object.values(data)) this.data.set(value.id, value)
        this.skinMapping = new Map<number, BodyData>();
        for (const v of this.data.values()) this.skinMapping.set(Number(v.skins), v);
    }

    static async create(): Promise<Body> {
        const data = await getLoader().loadBodies();
        return new Body(data);
    }
}

let _bodiesPromise: Promise<Body> | undefined;

export function getBodies(): Promise<Body> {
    return _bodiesPromise ??= Body.create();
}