import { describe, expect, it } from "vitest";
import { decodeVarintAt, encodeVarint } from "../src/codec/varint";

const peekFrom = (buf: Uint8Array) => (i: number) => (i < buf.length ? buf[i]! : null);

describe("varint encode/decode", () => {
    it("encodes integers into MQTT remaining length varints", () => {
        expect(Array.from(encodeVarint(0))).toEqual([0x00]);
        expect(Array.from(encodeVarint(127))).toEqual([0x7f]);
        expect(Array.from(encodeVarint(128))).toEqual([0x80, 0x01]);
        expect(Array.from(encodeVarint(321))).toEqual([0xc1, 0x02]);
    });

    it("decodes varints with offsets", () => {
        const buf = Uint8Array.from([0x00, 0x80, 0x01, 0x7f]);
        expect(decodeVarintAt(peekFrom(buf), 0)).toEqual({ value: 0, bytes: 1 });
        expect(decodeVarintAt(peekFrom(buf), 1)).toEqual({ value: 128, bytes: 2 });
        expect(decodeVarintAt(peekFrom(buf), 3)).toEqual({ value: 127, bytes: 1 });
    });

    it("returns null when the buffer is truncated", () => {
        const buf = Uint8Array.from([0x80]);
        expect(decodeVarintAt(peekFrom(buf), 0)).toBeNull();
    });

    it("throws on malformed oversized varints", () => {
        const buf = Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x01]);
        expect(() => decodeVarintAt(peekFrom(buf), 0)).toThrowError("Malformed Remaining Length varint");
    });

    it("rejects invalid inputs when encoding", () => {
        expect(() => encodeVarint(-1)).toThrowError("Invalid varint");
    });
});

