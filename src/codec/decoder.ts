import { readU16BE, readString } from "./binary";
import type { QoS } from "../client/types";

export function decodeConnack(body: Uint8Array): { sessionPresent: boolean; returnCode: number } {
    if (body.length < 2) {
        throw new Error("Malformed CONNACK");
    }
    return { sessionPresent: (body[0]! & 0x01) === 0x01, returnCode: body[1]! };
}

export function decodeSuback(body: Uint8Array): { packetId: number; returnCodes: number[] } {
    if (body.length < 3) {
        throw new Error("Malformed SUBACK");
    }
    const packetId = readU16BE(body, 0);
    const returnCodes = Array.from(body.slice(2));
    return { packetId, returnCodes };
}

export function decodeUnsuback(body: Uint8Array): { packetId: number } {
    if (body.length < 2) {
        throw new Error("Malformed UNSUBACK");
    }
    return { packetId: readU16BE(body, 0) };
}

export function decodePublish(
    flags: number,
    body: Uint8Array
): {
    topic: string;
    bytes: Uint8Array;
    qos: QoS;
    retain: boolean;
    dup: boolean;
} {
    const retain = (flags & 0x01) === 0x01;
    const qos = ((flags >> 1) & 0x03) as QoS;
    const dup = (flags & 0x08) === 0x08;

    let offset = 0;
    const topic = readString(body, offset);
    offset += topic.bytes;

    if (qos > 0) {
        if (offset + 2 > body.length) {
            throw new Error("Malformed PUBLISH (missing packet id)");
        }
        offset += 2;
    }

    const bytes = body.slice(offset);
    return { topic: topic.value, bytes, qos, retain, dup };
}