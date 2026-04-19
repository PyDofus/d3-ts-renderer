export const enum Directions {
    RIGHT = 0,
    DOWN_RIGHT = 1,
    DOWN = 2,
    DOWN_LEFT = 3,
    LEFT = 4,
    UP_LEFT = 5,
    UP = 6,
    UP_RIGHT = 7,
}

const oppositeMapping: Readonly<Partial<Record<Directions, Directions>>> = {
    [Directions.RIGHT]: Directions.LEFT,
    [Directions.DOWN_RIGHT]: Directions.DOWN_LEFT,
    [Directions.DOWN_LEFT]: Directions.DOWN_RIGHT,
    [Directions.LEFT]: Directions.RIGHT,
    [Directions.UP_LEFT]: Directions.UP_RIGHT,
    [Directions.UP_RIGHT]: Directions.UP_LEFT,
};

export function oppositeDirection(d: Directions): Directions | undefined {
    return oppositeMapping[d];
}

export function flipAnimName(animName: string, d: Directions): string {
    const opp = oppositeDirection(d);
    if (opp === undefined) return animName;
    const idx = animName.lastIndexOf('_');
    return `${idx === -1 ? animName : animName.slice(0, idx)}_${opp}`;
}

export function flipAnimNameString(animName: string): string {
    const idx = animName.indexOf('_');
    if (idx === -1) return animName;

    const name = animName.slice(0, idx);
    const dirStr = animName.slice(idx + 1);
    const opp = oppositeDirection(Number(dirStr) as Directions);
    if (opp === undefined) return animName;

    return `${name}_${opp}`;
}
