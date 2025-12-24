import { describe, expect, it } from "vitest";
import { getSharedCore, releaseSharedCore } from "../src/client/shared";
import type { ResolvedSmartQTTOptions } from "../src/client/types";

const makeOpts = (sharedKey = ""): ResolvedSmartQTTOptions => ({
    clientId: "client-shared",
    username: undefined,
    password: undefined,
    autoConnect: false,
    cleanSession: true,
    keepAliveSec: 0,
    pingTimeoutMs: 1_000,
    connectTimeoutMs: 1_000,
    reconnect: { enabled: false, minDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    shared: true,
    sharedKey,
    maxQueueBytes: 1_024_000,
    ws: { protocols: "mqtt" }
});

describe("shared core registry", () => {
    it("reuses the same core for identical keys", () => {
        const opts = makeOpts();
        const first = getSharedCore("ws://broker", opts);
        const second = getSharedCore("ws://broker", opts);

        expect(first).toBe(second);

        releaseSharedCore(first);
        releaseSharedCore(second);
    });

    it("separates cores by sharedKey", () => {
        const first = getSharedCore("ws://broker", makeOpts("one"));
        const second = getSharedCore("ws://broker", makeOpts("two"));

        expect(first).not.toBe(second);

        releaseSharedCore(first);
        releaseSharedCore(second);
    });
});

