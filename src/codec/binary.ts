const te = new TextEncoder();
const td = new TextDecoder();

export function u16be(n: number): Uint8Array {
    return Uint8Array.from([(n >> 8) & 0xff, n & 0xff]);
}

export function encodeUtf8(str: string): Uint8Array {
    return te.encode(str);
}

export function decodeUtf8(buf: Uint8Array): string {
    return td.decode(buf);
}

export function encodeString(str: string): Uint8Array {
    const s = encodeUtf8(str);
    const out = new Uint8Array(2 + s.length);
    out[0] = (s.length >> 8) & 0xff;
    out[1] = s.length & 0xff;
    out.set(s, 2);
    return out;
}

export function readU16BE(buf: Uint8Array, offset: number): number {
    return (buf[offset]! << 8) | buf[offset + 1]!;
}

export function readString(buf: Uint8Array, offset: number): { value: string; bytes: number } {
    const len = readU16BE(buf, offset);
    const start = offset + 2;
    const end = start + len;
    if (end > buf.length) {
        throw new Error("String out of bounds");
    }
    return { value: decodeUtf8(buf.slice(start, end)), bytes: 2 + len };
}

export function concat(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}