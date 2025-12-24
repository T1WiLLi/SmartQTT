import { ByteQueue } from "../util/byte-queue";
import { decodeVarintAt } from "./varint";

export type RawPacket = {
    type: number; // 1..14
    flags: number;
    body: Uint8Array;
};

export class MqttParser {
    private q = new ByteQueue();

    constructor(private readonly maxPacketBytes = 1024 * 1024) { }

    push(chunk: Uint8Array): RawPacket[] {
        this.q.push(chunk);
        const out: RawPacket[] = [];

        for (; ;) {
            if (this.q.length < 2) {
                break;
            }

            const byte1 = this.q.peek(0)!;
            const type = byte1 >> 4;
            const flags = byte1 & 0x0f;

            const rl = decodeVarintAt((i) => this.q.peek(i), 1);
            if (!rl) {
                break;
            }

            const headerBytes = 1 + rl.bytes;
            const totalBytes = headerBytes + rl.value;

            if (rl.value > this.maxPacketBytes) {
                throw new Error(`Packet too large: ${rl.value}`);
            }
            if (this.q.length < totalBytes) {
                break;
            }

            this.q.skip(headerBytes);
            const body = this.q.readSlice(rl.value);
            out.push({ type, flags, body });
        }

        return out;
    }
}