import { describe, expect, it } from "vitest";
import {
    concat,
    decodeUtf8,
    encodeString,
    encodeUtf8,
    readString,
    u16be
} from "../src/codec/binary";

describe("binary helpers", () => {
    it("encodes and decodes UTF-8", () => {
        const original = "mqtt/topic";
        const encoded = encodeUtf8(original);
        const decoded = decodeUtf8(encoded);
        expect(decoded).toBe(original);
    });

    it("prefix-encodes strings with length", () => {
        const encoded = encodeString("abc");
        expect(Array.from(encoded)).toEqual([0x00, 0x03, 0x61, 0x62, 0x63]);
    });

    it("reads encoded strings and reports consumed bytes", () => {
        const source = encodeString("mqtt");
        const { value, bytes } = readString(source, 0);
        expect(value).toBe("mqtt");
        expect(bytes).toBe(source.length);
    });

    it("throws if string is out of bounds", () => {
        const buf = Uint8Array.from([0x00, 0x05, 0x61, 0x62]);
        expect(() => readString(buf, 0)).toThrowError("String out of bounds");
    });

    it("concatenates byte arrays in order", () => {
        const parts = [u16be(1), Uint8Array.from([0xaa]), Uint8Array.from([0xbb, 0xcc])];
        expect(Array.from(concat(parts))).toEqual([0x00, 0x01, 0xaa, 0xbb, 0xcc]);
    });
});
