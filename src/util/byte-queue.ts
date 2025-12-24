export class ByteQueue {
    private chunks: Uint8Array[] = [];
    private headOffset = 0;
    private _length = 0;

    get length(): number {
        return this._length;
    }

    push(chunk: Uint8Array): void {
        if (chunk.length === 0) {
            return;
        }
        this.chunks.push(chunk);
        this._length += chunk.length;
    }

    peek(i: number): number | null {
        if (i < 0 || i >= this._length) return null;
        let idx = i + this.headOffset;

        for (let c = 0; c < this.chunks.length; c++) {
            const chunk = this.chunks[c]!;
            if (idx < chunk.length) return chunk[idx]!;
            idx -= chunk.length;
        }
        return null;
    }

    readSlice(count: number): Uint8Array {
        if (count > this._length) throw new Error("ByteQueue underflow");
        const out = new Uint8Array(count);

        let written = 0;
        while (written < count) {
            const head = this.chunks[0]!;
            const available = head.length - this.headOffset;
            const take = Math.min(available, count - written);

            out.set(head.subarray(this.headOffset, this.headOffset + take), written);
            written += take;

            this.headOffset += take;
            this._length -= take;

            if (this.headOffset >= head.length) {
                this.chunks.shift();
                this.headOffset = 0;
            }
        }

        return out;
    }

    skip(count: number): void {
        if (count > this._length) throw new Error("ByteQueue underflow");
        let remaining = count;

        while (remaining > 0) {
            const head = this.chunks[0]!;
            const available = head.length - this.headOffset;
            const take = Math.min(available, remaining);

            this.headOffset += take;
            this._length -= take;
            remaining -= take;

            if (this.headOffset >= head.length) {
                this.chunks.shift();
                this.headOffset = 0;
            }
        }
    }
}
