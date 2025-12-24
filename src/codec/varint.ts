export function encodeVarint(n: number): Uint8Array {
    if (!Number.isInteger(n) || n < 0) {
        throw new Error("Invalid varint");
    }
    const out: number[] = [];
    do {
        let digit = n % 128;
        n = Math.floor(n / 128);
        if (n > 0) {
            digit |= 0x80;
        }
        out.push(digit);
    } while (n > 0);
    return Uint8Array.from(out);
}

export function decodeVarintAt(
    peek: (i: number) => number | null,
    offset: number
): { value: number; bytes: number } | null {
    let multiplier = 1;
    let value = 0;

    for (let i = 0; i < 4; i++) {
        const b = peek(offset + i);
        if (b == null) {
            return null;
        }

        value += (b & 0x7f) * multiplier;
        multiplier *= 128;

        if ((b & 0x80) === 0) {
            return { value, bytes: i + 1 };
        }
    }

    throw new Error("Malformed Remaining Length varint");
}