import { describe, expect, it } from "vitest";
import { decodeConnack, decodePublish, decodeSuback, decodeUnsuback } from "../src/codec/decoder";
import {
    connectPacket,
    disconnectPacket,
    normalizePayload,
    pingreqPacket,
    publishPacket,
    subscribePacket,
    unsubscribePacket
} from "../src/codec/packet";
import { decodeUtf8, readString, readU16BE } from "../src/codec/binary";
import { MqttParser } from "../src/codec/parser";

describe("codec packets", () => {
    it("encodes CONNECT with username/password and flags", () => {
        const pkt = connectPacket({
            clientId: "client-1",
            cleanSession: true,
            keepAliveSec: 10,
            username: "user",
            password: "pass"
        });

        expect(pkt[0]).toBe(0x10); // CONNECT type
        const body = pkt.slice(2); // remaining length fits in one byte for this payload

        let offset = 0;
        const protocol = readString(body, offset);
        offset += protocol.bytes;
        expect(protocol.value).toBe("MQTT");

        expect(body[offset++]).toBe(0x04); // protocol level

        const flags = body[offset++]!;
        expect(flags & 0x80).toBe(0x80); // username flag
        expect(flags & 0x40).toBe(0x40); // password flag
        expect(flags & 0x02).toBe(0x02); // clean session

        const keepAlive = readU16BE(body, offset);
        expect(keepAlive).toBe(10);
        offset += 2;

        const clientId = readString(body, offset);
        offset += clientId.bytes;
        expect(clientId.value).toBe("client-1");

        const username = readString(body, offset);
        offset += username.bytes;
        expect(username.value).toBe("user");

        const password = readString(body, offset);
        expect(password.value).toBe("pass");
    });

    it("encodes and decodes PUBLISH flags and payload", () => {
        const payloadText = "hello";
        const pkt = publishPacket("topic/1", normalizePayload(payloadText), { qos: 0, retain: true, dup: true });

        const [{ flags, body }] = new MqttParser().push(pkt);
        const decoded = decodePublish(flags, body);

        expect(decoded).toMatchObject({
            topic: "topic/1",
            qos: 0,
            retain: true,
            dup: true
        });
        expect(decodeUtf8(decoded.bytes)).toBe(payloadText);
    });

    it("encodes subscribe and unsubscribe frames with packet IDs", () => {
        const sub = subscribePacket(10, [{ topic: "a", qos: 1 }]);
        expect(sub[0]).toBe(0x82);
        expect(sub[2]).toBe(0x00);
        expect(sub[3]).toBe(0x0a);

        const subackPacket = Uint8Array.from([0x90, 0x03, 0x00, 0x0a, 0x01]);
        const parsedSuback = new MqttParser().push(subackPacket)[0]!;
        expect(decodeSuback(parsedSuback.body)).toEqual({ packetId: 10, returnCodes: [1] });

        const unsub = unsubscribePacket(11, ["a"]);
        expect(unsub[0]).toBe(0xa2);
        expect(unsub[2]).toBe(0x00);
        expect(unsub[3]).toBe(0x0b);

        const unsuback = Uint8Array.from([0xb0, 0x02, 0x00, 0x0b]);
        const parsedUnsuback = new MqttParser().push(unsuback)[0]!;
        expect(decodeUnsuback(parsedUnsuback.body)).toEqual({ packetId: 11 });
    });

    it("decodes CONNACK payload", () => {
        const connack = Uint8Array.from([0x20, 0x02, 0x01, 0x05]); // session present + return code 5
        const parsed = new MqttParser().push(connack)[0]!;
        expect(decodeConnack(parsed.body)).toEqual({ sessionPresent: true, returnCode: 5 });
    });

    it("provides basic control packets", () => {
        expect(Array.from(pingreqPacket())).toEqual([0xc0, 0x00]);
        expect(Array.from(disconnectPacket())).toEqual([0xe0, 0x00]);
    });
});

