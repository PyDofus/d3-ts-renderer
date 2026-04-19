import type {BodyData} from "./types";
import {DataLoader, loader} from "./loader";


class Body {
    readonly data: Map<number, BodyData>;
    readonly skinMapping: Map<number, BodyData>

    private constructor(data: Record<string, BodyData>) {
        this.data = new Map<number, BodyData>();
        for (const value of Object.values(data)) {
            this.data.set(value.id, value)
        }
        this.skinMapping = new Map<number, BodyData>();
        for (const v of this.data.values()) {
            this.skinMapping.set(Number(v.skins), v);
        }
    }

    static async create(loader: DataLoader): Promise<Body> {
        const data = await loader.loadBodies();
        return new Body(data);
    }
}

export const bodies = await Body.create(loader)
