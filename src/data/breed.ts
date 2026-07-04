import type {BreedsData} from "./types";
import {getLoader} from "./loader";


export class Breed {
    readonly data: Map<number, BreedsData>;

    private constructor(data: Record<string, BreedsData>) {
        this.data = new Map<number, BreedsData>();
        for (const value of Object.values(data)) this.data.set(value.id, value)
    }

    static async create(): Promise<Breed> {
        const data = await getLoader().loadBreeds();
        return new Breed(data);
    }
}

let _breedsPromise: Promise<Breed> | undefined;

export function getBreeds(): Promise<Breed> {
    return _breedsPromise ??= Breed.create();
}
