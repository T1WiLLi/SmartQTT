import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartQTTCore } from "../src/client/core";
import type { ResolvedSmartQTTOptions } from "../src/client/types";
import { connectPacket, publishPacket } from "../src/codec/packet";
import { encodeUtf8 } from "../src/codec/binary";

class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: FakeWebSocket[] = [];

    readyState = FakeWebSocket.CONNECTING;
    binaryType: string = "arraybuffer";
    bufferedAmount = 0;
    sent: Uint8Array[] = [];

    private listeners = new Map<string, Set<(ev: any) => void>>();

    constructor(public url: string, public protocols?: string | string[]) {
        FakeWebSocket.instances.push(this);
    }

    addEventListener(type: string, handler: (ev: any) => void): void {
        let set = this.listeners.get(type);
        if (!set) {
            set = new Set();
            this.listeners.set(type, set);
        }
        set.add(handler);
    }

    removeEventListener(type: string, handler: (ev: any) => void): void {
        this.listeners.get(type)?.delete(handler);
    }

    private emit(type: string, event: Record<string, any> = {}): void {
        const ev = { ...event, type };
        for (const handler of Array.from(this.listeners.get(type) ?? [])) {
            handler(ev);
        }
    }

    accept(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", { target: this });
    }

    fail(): void {
        this.emit("error", { target: this });
    }

    send(data: any): void {
        this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data));
    }

    close(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.emit("close", { target: this, code: 1000 });
    }

    message(data: Uint8Array): void {
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        this.emit("message", { data: buffer });
    }

    static reset(): void {
        FakeWebSocket.instances = [];
    }
}

const makeOpts = (overrides: Partial<ResolvedSmartQTTOptions> = {}): ResolvedSmartQTTOptions => ({
    clientId: "client-123",
    username: overrides.username,
    password: overrides.password,
    autoConnect: false,
    cleanSession: true,
    keepAliveSec: overrides.keepAliveSec ?? 2,
    pingTimeoutMs: overrides.pingTimeoutMs ?? 200,
    connectTimeoutMs: overrides.connectTimeoutMs ?? 500,
    reconnect: {
        enabled: overrides.reconnect?.enabled ?? false,
        minDelayMs: overrides.reconnect?.minDelayMs ?? 50,
        maxDelayMs: overrides.reconnect?.maxDelayMs ?? 1_000,
        jitterRatio: overrides.reconnect?.jitterRatio ?? 0
    },
    shared: overrides.shared ?? false,
    sharedKey: overrides.sharedKey ?? "",
    maxQueueBytes: overrides.maxQueueBytes ?? 1024 * 1024,
    ws: {
        protocols: overrides.ws?.protocols ?? "mqtt"
    }
});

beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).window = {
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    };
    (globalThis as any).WebSocket = FakeWebSocket as any;
});

afterEach(() => {
    vi.useRealTimers();
    FakeWebSocket.reset();
    delete (globalThis as any).WebSocket;
    delete (globalThis as any).window;
});

describe("SmartQTTCore", () => {
    it("sends CONNECT and resolves after CONNACK", async () => {
        const opts = makeOpts();
        const core = new SmartQTTCore("ws://broker", opts);
        core.addRef();

        const connectPromise = core.connect();
        const ws = FakeWebSocket.instances[0]!;
        ws.accept();
        await Promise.resolve();

        ws.message(Uint8Array.from([0x20, 0x02, 0x00, 0x00]));
        await Promise.resolve();
        await connectPromise;

        const expected = connectPacket({
            clientId: opts.clientId,
            cleanSession: opts.cleanSession,
            keepAliveSec: opts.keepAliveSec,
            username: opts.username,
            password: opts.password
        });
        expect(ws.sent.length).toBeGreaterThan(0);
        expect(Array.from(ws.sent[0]!)).toEqual(Array.from(expected));
        expect(core.connected).toBe(true);
    });

    it("fails the connection if CONNACK times out", async () => {
        const opts = makeOpts({ connectTimeoutMs: 50 });
        const core = new SmartQTTCore("ws://broker", opts);
        core.addRef();

        const connectPromise = core.connect();
        const rejection = expect(connectPromise).rejects.toThrowError("Disconnected");
        const ws = FakeWebSocket.instances[0]!;
        ws.accept();

        await vi.advanceTimersByTimeAsync(60);
        await rejection;
        expect(core.connected).toBe(false);
    });

    it("routes PUBLISH frames to subscribed handlers with decoding", async () => {
        const opts = makeOpts({ keepAliveSec: 0, connectTimeoutMs: 2_000 });
        const core = new SmartQTTCore("ws://broker", opts);
        const handle = core.createHandle();
        core.addRef();
        (core as any).state = "closed"; // skip broker subscribe

        const handler = vi.fn();
        const unsubscribe = core.subscribe(handle, "sensors/+/temp", handler, 0, "json");

        const payload = encodeUtf8(JSON.stringify({ value: 72 }));
        const publish = publishPacket("sensors/1/temp", payload, { qos: 0 });
        (core as any).onData(publish);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toMatchObject({
            topic: "sensors/1/temp",
            qos: 0,
            retain: false,
            dup: false
        });
        expect(handler.mock.calls[0][0].payload).toEqual({ value: 72 });

        unsubscribe();
    });

    it("sends keepalive PINGREQ and disconnects on missing PINGRESP", async () => {
        const opts = makeOpts({ keepAliveSec: 2, pingTimeoutMs: 100 });
        const core = new SmartQTTCore("ws://broker", opts);
        const ws = new FakeWebSocket("ws://broker");
        ws.readyState = FakeWebSocket.OPEN;
        (core as any).ws = ws;
        (core as any).state = "connected";
        (core as any).lastActivityAt = Date.now() - 10_000;

        ws.sent = [];
        (core as any).startKeepAlive();
        await vi.advanceTimersByTimeAsync(1_000); // half keepalive interval
        expect(ws.sent.some((b) => b[0] === 0xc0)).toBe(true);

        await vi.advanceTimersByTimeAsync(100);
        expect(core.connected).toBe(false);
    });
});
