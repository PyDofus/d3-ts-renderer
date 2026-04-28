export class BinaryReader {
    private readonly _view: DataView;
    pos = 0;

    constructor(buffer: ArrayBuffer) {
        this._view = new DataView(buffer);
    }

    get u8(): number {
        return this._view.getUint8(this.pos++);
    }

    get i8(): number {
        return this._view.getInt8(this.pos++);
    }

    get u16(): number {
        const v = this._view.getUint16(this.pos, true);
        this.pos += 2;
        return v;
    }

    get i16(): number {
        const v = this._view.getInt16(this.pos, true);
        this.pos += 2;
        return v;
    }

    get i32(): number {
        const v = this._view.getInt32(this.pos, true);
        this.pos += 4;
        return v;
    }

    get u32(): number {
        const v = this._view.getUint32(this.pos, true);
        this.pos += 4;
        return v;
    }

    get f32(): number {
        const v = this._view.getFloat32(this.pos, true);
        this.pos += 4;
        return v;
    }

    get bool(): boolean {
        return this.u8 !== 0;
    }

    str(length: number): string {
        const bytes = new Uint8Array(this._view.buffer, this.pos, length);
        this.pos += length;
        return new TextDecoder().decode(bytes);
    }

    align(n: number): this {
        const rem = this.pos % n;
        if (rem !== 0) this.pos += n - rem;
        return this;
    }

    skip(n: number): this {
        this.pos += n;
        return this;
    }

    readU16Multiple(count: number): number[] {
        return Array.from({length: count}, () => this.u16);
    }

    readI16Multiple(count: number): number[] {
        return Array.from({length: count}, () => this.i16);
    }

    readI32Multiple(count: number): number[] {
        return Array.from({length: count}, () => this.i32);
    }

    readF32Multiple(count: number): number[] {
        return Array.from({length: count}, () => this.f32);
    }

    readF32Array(count: number): Float32Array {
        const arr = new Float32Array(count);
        for (let i = 0; i < count; i++) arr[i] = this.f32;
        return arr;
    }

    readBoolMultiple(count: number): boolean[] {
        return Array.from({length: count}, () => this.u8 !== 0);
    }

    readRgba(): [number, number, number, number] {
        return [this.i8/127, this.i8/127, this.i8/127, this.i8/127];
    }
}

export function fourcc(buf: Uint8Array, offset: number): string {
    return String.fromCharCode(buf[offset]!, buf[offset + 1]!, buf[offset + 2]!, buf[offset + 3]!);
}

export function readU16LE(buf: Uint8Array, o: number): number {
    return buf[o]! | (buf[o + 1]! << 8);
}

export function readU24LE(buf: Uint8Array, o: number): number {
    return buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16);
}

export function readU32LE(buf: Uint8Array, o: number): number {
    return (buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16) | (buf[o + 3]! * 0x1000000)) >>> 0;
}

export function writeFourCC(buf: Uint8Array, o: number, s: string): void {
    buf[o] = s.charCodeAt(0);
    buf[o + 1] = s.charCodeAt(1);
    buf[o + 2] = s.charCodeAt(2);
    buf[o + 3] = s.charCodeAt(3);
}

export function writeU16LE(buf: Uint8Array, o: number, v: number): void {
    buf[o] = v & 0xFF;
    buf[o + 1] = (v >>> 8) & 0xFF;
}

export function writeU24LE(buf: Uint8Array, o: number, v: number): void {
    buf[o] = v & 0xFF;
    buf[o + 1] = (v >>> 8) & 0xFF;
    buf[o + 2] = (v >>> 16) & 0xFF;
}

export function writeU32LE(buf: Uint8Array, o: number, v: number): void {
    buf[o] = v & 0xFF;
    buf[o + 1] = (v >>> 8) & 0xFF;
    buf[o + 2] = (v >>> 16) & 0xFF;
    buf[o + 3] = (v >>> 24) & 0xFF;
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}
