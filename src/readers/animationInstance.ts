import {BinaryReader} from './binaryReader';
import {RenderState} from './renderState';

export interface AnimationLabel {
    frame: number;
    label: string;
}

export class AnimationInstance {
    readonly frameCount: number;
    readonly nodeCount: number;
    readonly labelCount: number;
    readonly combinedNodeState: number;
    readonly labels: AnimationLabel[];
    readonly frameDataPositions: readonly number[];
    private readonly _data: BinaryReader;
    private readonly _renderStates: RenderState[];
    private _renderStateFresh = true;

    constructor(data: BinaryReader) {
        this.frameCount = data.u16;
        this.nodeCount = data.u16;
        this.labelCount = data.u16;
        this.combinedNodeState = data.u8;

        this.labels = [];
        data.pos = 8;
        for (let i = 0; i < this.labelCount; i++) {
            const frame = data.u16;
            const label = data.str(data.u8);
            data.align(2);
            this.labels.push({frame, label});
        }
        data.align(4);

        this.frameDataPositions = data.readI32Multiple(this.frameCount);
        this._data = data;
        this._renderStates = Array.from({length: this.nodeCount}, () => new RenderState());
    }

    /** Yields frame indices, advancing internal render-state cursors as a side effect. */
    * iterFrameData(maxFrame?: number, startFrame = 0): Iterable<number> {
        this._claimRenderStates();
        const limit = maxFrame ?? this.frameCount;
        const start = startFrame < 0 ? Math.max(this.frameCount + startFrame, 0) : startFrame;

        if (start > 0) {
            for (let i = 0; i < start; i++) {
                this._data.pos = this.frameDataPositions[i]!;
                for (const _ of this.iterRenderStates()) { /* consume */
                }
            }
        }

        for (let i = 0; i < limit; i++) {
            this._data.pos = this.frameDataPositions[(i + start) % this.frameCount]!;
            yield i;
        }
    }

    * iterRenderStates(): IterableIterator<RenderState> {
        for (let i = 0; i < this.nodeCount; i++) {
            const state = this._renderStates[this._data.i16]!;
            state.compute(this._data);
            yield state;
        }
    }

    private _claimRenderStates(): void {
        if (!this._renderStateFresh) for (let i = 0; i < this._renderStates.length; i++) this._renderStates[i]!.reset();
        this._renderStateFresh = false;
    }
}
