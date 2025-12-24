import { concat, encodeString, u16be, encodeUtf8 } from "./binary";
import { encodeVarint } from "./varint";
import type { QoS } from "../client/types";

export type ConnectOptions = {
    clientId: string;
    cleanSession: boolean;
    keepAliveSec: number;
    username?: string;
    password?: string;
};

function packet(typeAndFlags: number, body: Uint8Array): Uint8Array {
    const rl = encodeVarint(body.length);
    return concat([Uint8Array.from([typeAndFlags]), rl, body]);
}

export function connectPacket(opts: ConnectOptions): Uint8Array {
    const protocolName = encodeString("MQTT");
    const protocolLevel = Uint8Array.from([0x04]); // MQTT 3.1.1

    const hasUser = typeof opts.username === "string";
    const hasPass = typeof opts.password === "string";

    let flags = 0;
    if (hasUser) {
        flags |= 0x80;
    }
    if (hasPass) {
        flags |= 0x40;
    }
    if (opts.cleanSession) {
        flags |= 0x02;
    }

    const keepAlive = u16be(opts.keepAliveSec);
    const vh = concat([protocolName, protocolLevel, Uint8Array.from([flags]), keepAlive]);

    const payloadParts: Uint8Array[] = [encodeString(opts.clientId)];
    if (hasUser) {
        payloadParts.push(encodeString(opts.username!));
    }
    if (hasPass) {
        payloadParts.push(encodeString(opts.password!));
    }
    const payload = concat(payloadParts);

    return packet(0x10, concat([vh, payload]));
}

export function pingreqPacket(): Uint8Array {
    return Uint8Array.from([0xc0, 0x00]);
}

export function disconnectPacket(): Uint8Array {
    return Uint8Array.from([0xe0, 0x00]);
}

export function subscribePacket(packetId: number, topics: Array<{ topic: string; qos: QoS }>): Uint8Array {
    const pid = u16be(packetId);
    const items: Uint8Array[] = [];
    for (const t of topics) {
        items.push(concat([encodeString(t.topic), Uint8Array.from([t.qos])]));
    }
    return packet(0x82, concat([pid, ...items]));
}

export function unsubscribePacket(packetId: number, topics: string[]): Uint8Array {
    const pid = u16be(packetId);
    const items: Uint8Array[] = topics.map(encodeString);
    return packet(0xa2, concat([pid, ...items]));
}

export function publishPacket(
    topic: string,
    payload: Uint8Array,
    opts: { qos?: QoS; retain?: boolean; dup?: boolean; packetId?: number } = {}
): Uint8Array {
    const qos = opts.qos ?? 0;
    const retain = !!opts.retain;
    const dup = !!opts.dup;

    let flags = 0;
    if (dup) {
        flags |= 0x08;
    }
    flags |= (qos & 0x03) << 1;
    if (retain) {
        flags |= 0x01;
    }

    const topicName = encodeString(topic);
    const pid = qos > 0 ? u16be(opts.packetId ?? 1) : new Uint8Array();

    return packet(0x30 | flags, concat([topicName, pid, payload]));
}

export function normalizePayload(payload: string | Uint8Array): Uint8Array {
    return typeof payload === "string" ? encodeUtf8(payload) : payload;
}
