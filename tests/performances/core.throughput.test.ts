import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { SmartQTTCore } from "../../src/client/core";
import type { ResolvedSmartQTTOptions } from "../../src/client/types";
import { publishPacket } from "../../src/codec/packet";
import { encodeUtf8 } from "../../src/codec/binary";
import { MqttParser } from "../../src/codec/parser";

const makeOpts = (): ResolvedSmartQTTOptions => ({
    clientId: "perf-client",
    username: undefined,
    password: undefined,
    autoConnect: false,
    cleanSession: true,
    keepAliveSec: 0,
    pingTimeoutMs: 5_000,
    connectTimeoutMs: 5_000,
    reconnect: { enabled: false, minDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    shared: false,
    sharedKey: "",
    maxQueueBytes: 10 * 1024 * 1024,
    ws: { protocols: "mqtt" }
});

describe("performance", () => {
    it("dispatches publish frames at high throughput", () => {
        const opts = makeOpts();
        const core = new SmartQTTCore("ws://broker", opts);
        const handle = core.createHandle();

        let processed = 0;
        core.subscribe(handle, "sensors/+/temp", () => {
            processed++;
        }, 0, "utf8");

        (core as any).state = "connected";

        const frame = publishPacket("sensors/1/temp", encodeUtf8('{"t":25}'), { qos: 0 });
        const total = 2_500_000;

        const start = performance.now();
        for (let i = 0; i < total; i++) {
            (core as any).onData(frame);
        }
        const durationMs = performance.now() - start;
        const rate = (processed / durationMs) * 1000;

        console.info(`[perf] core dispatch: ${processed} msgs in ${durationMs.toFixed(1)}ms (~${Math.round(rate)} msg/s)`);

        expect(processed).toBe(total);
        expect(rate).toBeGreaterThan(5_000);
    });

    it("parses large batched frames efficiently", () => {
        const parser = new MqttParser();
        const frame = Uint8Array.from([0xc0, 0x00]); // PINGREQ
        const batchSize = 50_000;
        const buffer = new Uint8Array(frame.length * batchSize);
        for (let i = 0; i < batchSize; i++) {
            buffer.set(frame, i * frame.length);
        }

        const start = performance.now();
        const packets = parser.push(buffer);
        const durationMs = performance.now() - start;
        const rate = (packets.length / durationMs) * 1000;

        console.info(`[perf] parser: ${packets.length} packets in ${durationMs.toFixed(1)}ms (~${Math.round(rate)} pkt/s)`);

        expect(packets.length).toBe(batchSize);
        expect(durationMs).toBeLessThan(2_000);
    });
});

