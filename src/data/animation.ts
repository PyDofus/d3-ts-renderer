import {Directions, oppositeDirection} from "./directions";

export function getAnimName(animations: string[], direction: Directions, bone: number, name?: string): [string, boolean] {
    let searchName = false;
    let baseName = name;

    if (baseName === undefined) {
        baseName = bone === 1 ? 'AnimStatiqueExplo0' : 'AnimStatique';
        searchName = true;
    }

    const candidate = `${baseName}_${direction}`;
    if (animations.includes(candidate)) return [candidate, false];

    const opp = oppositeDirection(direction);
    if (opp !== undefined) {
        const flipped = `${baseName}_${opp}`;
        if (animations.includes(flipped)) return [flipped, true];
    }

    if (searchName) {
        for (const d of opp !== undefined ? [direction, opp] : [direction]) {
            const found = animations.find(k => k.endsWith(`_${d}`));
            if (found) return [found, d !== direction];
        }
        if (animations.length > 0) return [animations[0]!, false];
    }

    throw new Error(
        `Cannot find animation '${baseName}' for direction ${direction}. Available: ${animations.join(', ')}`,
    );
}


export function getRelatedChildAnim(animations: string[], animParent: string): [string | undefined, boolean] {
    const cleanString = animParent.replace(/(Explo|Combat)\d+/, '');
    if (animations.includes(cleanString)) return [cleanString, false];

    const lastUnderscore = animParent.lastIndexOf('_');
    if (lastUnderscore === -1) return [undefined, false];
    const baseName = animParent.slice(0, lastUnderscore);
    const orientation = animParent.slice(lastUnderscore + 1);

    const found = childAnimName(animations, baseName, orientation);
    if (found) return [found, false];

    if (/^\d+$/.test(orientation)) {
        const oppDir = oppositeDirection(parseInt(orientation) as Directions);
        if (oppDir !== undefined) {
            const found2 = childAnimName(animations, baseName, String(oppDir));
            if (found2) return [found2, true];
        }
    }

    return [undefined, false];
}

function childAnimName(animations: string[], baseName: string, orientation: string): string | undefined {
    const candidates = [
        `${baseName}Explo0_${orientation}`,
        `${baseName}_${orientation}`,
        `AnimStatiqueExplo0_${orientation}`,
        `AnimStatique_${orientation}`,
        `FX_${orientation}`,
    ];
    return candidates.find(c => animations.includes(c));
}
