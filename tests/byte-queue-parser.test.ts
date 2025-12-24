import { describe, expect, it } from "vitest";
import { MqttParser } from "../src/codec/parser";
import { ByteQueue } from "../src/util/byte-queue";

describe("ByteQueue", () => {
    it("tracks length, peek, and readSlice correctly", () => {
        const q = new ByteQueue();
        q.push(Uint8Array.from([0x01, 0x02, 0x03]));
        q.push(Uint8Array.from([0x04]));

        expect(q.length).toBe(4);
        expect(q.peek(0)).toBe(0x01);
        expect(q.peek(3)).toBe(0x04);

        const firstTwo = q.readSlice(2);
        expect(Array.from(firstTwo)).toEqual([0x01, 0x02]);
        expect(q.length).toBe(2);

        q.skip(1);
        expect(q.length).toBe(1);
        expect(q.peek(0)).toBe(0x04);
    });

    it("throws on underflow when reading or skipping too much", () => {
        const q = new ByteQueue();
        q.push(Uint8Array.from([0xaa]));
        expect(() => q.readSlice(2)).toThrowError("ByteQueue underflow");
        expect(() => q.skip(5)).toThrowError("ByteQueue underflow");
    });
});

describe("MqttParser", () => {
    it("waits for full headers before emitting packets", () => {
        const parser = new MqttParser();
        const connectPacket = Uint8Array.from([0x10, 0x00]); // CONNECT with empty body

        expect(parser.push(connectPacket.subarray(0, 1))).toHaveLength(0);
        const packets = parser.push(connectPacket.subarray(1));
        expect(packets).toHaveLength(1);
        expect(packets[0]).toMatchObject({ type: 1, flags: 0, body: new Uint8Array() });
    });

    it("parses multiple packets even when chunks are concatenated", () => {
        const parser = new MqttParser();
        const pingreq = Uint8Array.from([0xc0, 0x00]);
        const pingresp = Uint8Array.from([0xd0, 0x00]);

        const packets = parser.push(Uint8Array.from([...pingreq, ...pingresp]));
        expect(packets).toHaveLength(2);
        expect(packets[0]).toMatchObject({ type: 12, flags: 0, body: new Uint8Array() });
        expect(packets[1]).toMatchObject({ type: 13, flags: 0, body: new Uint8Array() });
    });

    it("rejects packets larger than configured maximum", () => {
        const parser = new MqttParser(1);
        const oversized = Uint8Array.from([0x30, 0x02, 0x00, 0x00]); // Remaining length=2 (> max)
        expect(() => parser.push(oversized)).toThrowError("Packet too large");
    });
});

