import type {DisplayListEntry, SkinAsset, SkinAssetPart as SkinAssetPartStub} from '../data/types.js';
import {type Bounds2D, type Mat3, mat3From, mat3Identity, mat3Mul, transformAABB} from '../math.js';
import type {RendererContext} from './rendererContext.js';

/** Stride in bytes for the interleaved vertex buffer: 2×f32 pos + 2×f32 uv + 1×u32 colorIdx. */
const VERTEX_STRIDE = 20;

function buildVertexBufferWithBounds(source: SkinAsset, startVertex: number, vertexCount: number): {
    buffer: ArrayBuffer;
    bounds: Bounds2D
} {
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    const buf = new ArrayBuffer(vertexCount * VERTEX_STRIDE);
    const view = new DataView(buf);
    for (let i = 0; i < vertexCount; i++) {
        const v = source.vertices[startVertex + i]!;
        view.setFloat32(i * VERTEX_STRIDE, v.pos.x, true);
        view.setFloat32(i * VERTEX_STRIDE + 4, v.pos.y, true);
        view.setFloat32(i * VERTEX_STRIDE + 8, v.uv.x, true);
        view.setFloat32(i * VERTEX_STRIDE + 12, v.uv.y, true);
        view.setUint32(i * VERTEX_STRIDE + 16, v.pos.z, true);

        if (v.pos.x < xMin) xMin = v.pos.x;
        if (v.pos.y < yMin) yMin = v.pos.y;
        if (v.pos.x > xMax) xMax = v.pos.x;
        if (v.pos.y > yMax) yMax = v.pos.y;
    }
    return {buffer: buf, bounds: {xMin, yMin, xMax, yMax}};
}

export class Vertexs {
    readonly textureId: number;
    readonly vertexData: ArrayBuffer;
    readonly indices: Uint32Array;
    readonly mask: number;
    readonly bounds: Bounds2D;

    constructor(textureId: number, source: SkinAsset, startVertex: number, vertexCount: number, startIndex: number, indexCount: number, mask: number) {
        this.textureId = textureId;
        this.mask = mask;
        const {buffer, bounds} = buildVertexBufferWithBounds(source, startVertex, vertexCount);
        this.vertexData = buffer;
        this.bounds = bounds;
        this.indices = new Uint32Array(source.triangles.slice(startIndex, startIndex + indexCount) as number[]);
    }

    /** Transform bounding-box corners by mat and return [x0,y0,…,x3,y3]. */
    transformedBounds(mat: Mat3): Bounds2D {
        return transformAABB(this.bounds, mat);
    }

    render(ctx: RendererContext, program: WebGLProgram): void {
        ctx.useProgram(program);
        ctx.drawIndexed(this.vertexData, this.indices);
    }
}

export class SkinAssetPart {
    readonly source: SkinAsset;
    readonly name: string;
    readonly entry: readonly DisplayListEntry[];
    readonly validSkinChunk: boolean;
    readonly transformMatrixEntry: readonly Mat3[];
    readonly skinChunks: readonly Vertexs[];

    constructor(stub: SkinAssetPartStub, source: SkinAsset, textureOffset: number) {
        this.source = source;
        this.name = stub.name;
        this.entry = stub.DisplayListEntry;
        this.validSkinChunk = stub.skinChunks.some(c => c.vertexCount > 0);
        this.transformMatrixEntry = this._createTransfoMatrix(stub.DisplayListEntry);
        this.skinChunks = this._createSkinChunks(stub, source, textureOffset);
    }

    getSymbolName(entry: DisplayListEntry): string | undefined {
        return this.source.referencedSymbols[entry.symbolId];
    }

    computeIndexUpdate(index: number, drawIndex: number): [nextIndex: number, nextDrawIndex: number] {
        const nextIndex = index + 1;
        const endIndex = nextIndex + Math.max(this.entry[index]!.entries, 0);
        let newDrawIndex = drawIndex;
        for (const e of this.entry.slice(nextIndex, endIndex)) {
            if (e.entries === -1) newDrawIndex++;
        }
        return [endIndex, newDrawIndex];
    }

    computeTransfo(index: number, transfo: Mat3 | null): Mat3 {
        const m = this.transformMatrixEntry[index];
        if (!m) return mat3Identity();
        return transfo === null ? m : mat3Mul(transfo, m);
    }

    private _createTransfoMatrix(entries: readonly DisplayListEntry[]): Mat3[] {
        return entries.map(e => {
            const t = e.transform;
            return mat3From(
                t.rX, -t.rY, t.tX,
                -t.uX, t.uY, -t.tY,
                0, 0, 1,
            );
        });
    }

    private _createSkinChunks(stub: SkinAssetPartStub, source: SkinAsset, textureOffset: number): Vertexs[] {
        return stub.skinChunks.map(s => new Vertexs(s.textureIndex + textureOffset, source, s.startVertexIndex, s.vertexCount, s.startIndexIndex, s.indexCount, s.maskState));
    }
}
