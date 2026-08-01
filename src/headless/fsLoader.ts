import { readFile } from 'node:fs/promises';
import { DataLoader } from '../data/loader';

/**
 * Node-only loader reading assets from disk.
 */
export class FsLoader extends DataLoader {
    protected async bytes(path: string): Promise<Uint8Array> {
        return readFile(this._base + path);
    }

    protected async json<T>(path: string): Promise<T> {
        const buf = await this.bytes(path);
        return JSON.parse(new TextDecoder().decode(buf));
    }

    protected async binary(path: string): Promise<ArrayBuffer> {
        const buf = await this.bytes(path);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }

    protected async imageBitmap(path: string): Promise<ImageBitmap> {
        throw new Error("FsLoader cannot decode ImageBitmap in Node. Provide decodeImage in config or DataLoader constructor.");
    }

}
