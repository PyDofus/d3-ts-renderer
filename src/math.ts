/**
 * Column-major 3×3 matrix as a 9-element Float32Array.
 * | a00 a01 a02 |
 * | a10 a11 a12 |
 * | a20 a21 a22 |
 */
export type Mat3 = Float32Array;

export function mat3Identity(): Mat3 {
    return new Float32Array([
        1, 0, 0,
        0, 1, 0,
        0, 0, 1
    ]);
}

export function mat3From(a00: number, a01: number, a02: number, a10: number, a11: number, a12: number, a20: number, a21: number, a22: number): Mat3 {
    return new Float32Array([
        a00, a10, a20,
        a01, a11, a21,
        a02, a12, a22
    ]);
}

export function mat3Scale(s: number): Mat3 {
    return mat3From(s, 0, 0, 0, s, 0, 0, 0, 1)
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
    return mat3MulInto(new Float32Array(9), a, b);
}

/** a · b written into `out`. Safe when out aliases a or b — inputs are read into locals first. */
export function mat3MulInto(out: Mat3, a: Mat3, b: Mat3): Mat3 {
    const a00 = a[0]!, a10 = a[1]!, a20 = a[2]!;
    const a01 = a[3]!, a11 = a[4]!, a21 = a[5]!;
    const a02 = a[6]!, a12 = a[7]!, a22 = a[8]!;

    const b00 = b[0]!, b10 = b[1]!, b20 = b[2]!;
    const b01 = b[3]!, b11 = b[4]!, b21 = b[5]!;
    const b02 = b[6]!, b12 = b[7]!, b22 = b[8]!;

    out[0] = a00 * b00 + a01 * b10 + a02 * b20;
    out[1] = a10 * b00 + a11 * b10 + a12 * b20;
    out[2] = a20 * b00 + a21 * b10 + a22 * b20;

    out[3] = a00 * b01 + a01 * b11 + a02 * b21;
    out[4] = a10 * b01 + a11 * b11 + a12 * b21;
    out[5] = a20 * b01 + a21 * b11 + a22 * b21;

    out[6] = a00 * b02 + a01 * b12 + a02 * b22;
    out[7] = a10 * b02 + a11 * b12 + a12 * b22;
    out[8] = a20 * b02 + a21 * b12 + a22 * b22;
    return out;
}

/** negate the first column (flip X axis) in place. */
export function mat3FlipX(m: Mat3): Mat3 {
    m[0] = -m[0]!;
    m[1] = -m[1]!;
    m[2] = -m[2]!;
    return m;
}

/**
 * Create a translation matrix with scale
 */
export function mat3Translation(m: Mat3, scale: number): Mat3 {
    return mat3From(
        1, 0, scale * m[6]!,
        0, 1, scale * m[7]!,
        0, 0, 1
    );
}

export type Bounds2D = { xMin: number; yMin: number; xMax: number; yMax: number };

export function transformAABB(b: Bounds2D, m: Mat3): Bounds2D {
    const a00 = m[0]!, a01 = m[3]!, a02 = m[6]!;
    const a10 = m[1]!, a11 = m[4]!, a12 = m[7]!;
    const { xMin, yMin, xMax, yMax } = b;
    const x1 = a00 * xMin + a01 * yMin + a02;
    const y1 = a10 * xMin + a11 * yMin + a12;
    const x2 = a00 * xMax + a01 * yMin + a02;
    const y2 = a10 * xMax + a11 * yMin + a12;
    const x3 = a00 * xMax + a01 * yMax + a02;
    const y3 = a10 * xMax + a11 * yMax + a12;
    const x4 = a00 * xMin + a01 * yMax + a02;
    const y4 = a10 * xMin + a11 * yMax + a12;
    return {
        xMin: Math.min(x1, x2, x3, x4),
        yMin: Math.min(y1, y2, y3, y4),
        xMax: Math.max(x1, x2, x3, x4),
        yMax: Math.max(y1, y2, y3, y4),
    };
}
