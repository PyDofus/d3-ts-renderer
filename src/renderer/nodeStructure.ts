import type {Vertexs} from './skinAssetPart.js';
import type {Mat3} from '../math.js';
import type {DofusSprite} from "./dofusSprite";

export interface NodeElementData {
    readonly transformation: Mat3;
    readonly vertexes: Vertexs;
}

export interface NodeElementSprite {
    readonly sprite: DofusSprite;
    readonly name: string;
    readonly transformation: Mat3 | null;
}

export type NodeElementGroup = readonly NodeElementData[] | readonly NodeElementSprite[];

export interface NodeElement {
    readonly index: string;
    readonly data: readonly NodeElementGroup[];
}

export function isDataGroup(group: NodeElementGroup): group is readonly NodeElementData[] {
    const first = group[0];
    return first !== undefined && 'vertexes' in first;
}

export function isSpriteGroup(group: NodeElementGroup): group is readonly NodeElementSprite[] {
    const first = group[0];
    return first !== undefined && 'sprite' in first;
}
// todo rework isdata and is sprite
