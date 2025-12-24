import { MqttParser } from "../codec/parser";
import { decodeConnack, decodePublish, decodeSuback, decodeUnsuback } from "../codec/decoder";
import {
    connectPacket,
    disconnectPacket,
    normalizePayload,
    pingreqPacket,
    publishPacket,
    subscribePacket,
    unsubscribePacket
} from "../codec/packet";
import { decodeUtf8 } from "../codec/binary";
import { matchTopic, isExactFilter } from "../util/topic-match";
import { Deferred } from "../util/deferred";
import { TypedEvents } from "../util/typed-event";
import type {
    QoS,
    SubscriptionHandler,
    DecodeMode,
    PublishOptions,
    DisconnectReason,
    ClientEventMap,
    IncomingMessage,
    ResolvedSmartQTTOptions
} from "./types.js";

type State = "idle" | "connecting" | "connected" | "closing" | "closed";

type Pending = {
    resolve: () => void;
    reject: (e: unknown) => void;
    timer: number;
};

type SubEntry = {
    id: number;
    handleId: symbol;
    handler: SubscriptionHandler<any>;
    decode: DecodeMode;
};

type FilterBucket = {
    filter: string;
    qos: QoS;
    entries: SubEntry[];
    brokerSubscribed: boolean;
};

const now = () => Date.now();

function backoff(attempt: number, min: number, max: number, jitterRatio: number): number {
    const base = Math.min(max, min * Math.pow(2, Math.max(0, attempt)));
    const jitter = base * jitterRatio * (Math.random() * 2 - 1);
    return Math.max(0, Math.floor(base + jitter));
}

function computeDisconnectReason(force: boolean, wasTimeout: boolean, hadError: boolean): DisconnectReason {
    if (force) return "requested";
    if (wasTimeout) return "timeout";
    if (hadError) return "error";
    return "socket_closed";
}

export class SmartQTTCore {
    private ws: WebSocket | null = null;
    private state: State = "idle";
    private forceCloseRequested = false;
    private lastCloseHadError = false;
    private lastCloseWasTimeout = false;

    private parser = new MqttParser(1024 * 1024);

    private connectDeferred: Deferred<void> | null = null;
    private connectTimer: number | null = null;

    private lastActivityAt = 0;
    private keepAliveTimer: number | null = null;
    private pingOutstanding = false;
    private pingTimeoutTimer: number | null = null;

    private reconnectAttempt = 0;
    private reconnectTimer: number | null = null;

    private nextPacketId = 1;

    // Acks
    private pendingSub = new Map<number, Pending>();
    private pendingUnsub = new Map<number, Pending>();

    // Outgoing queue
    private outQ: Uint8Array[] = [];
    private outBytes = 0;
    private flushing = false;

    // Sharing ref count
    private refCount = 0;

    // Per-handle event emitters (so dispose removes listeners)
    private handleEvents = new Map<symbol, TypedEvents<ClientEventMap>>();

    // Subscriptions:
    private exact = new Map<string, FilterBucket>();
    private wildcard: FilterBucket[] = [];

    // Per-handle entry indices for fast dispose
    private nextSubId = 1;
    private subIdToFilter = new Map<number, { filter: string; isExact: boolean }>();
    private handleToSubIds = new Map<symbol, Set<number>>();

    constructor(private readonly url: string, private readonly opts: ResolvedSmartQTTOptions) { }

    // ----- Sharing -----

    addRef(): void {
        this.refCount++;
    }

    release(): void {
        this.refCount--;
        if (this.refCount <= 0) {
            this.disconnect(true);
        }
    }

    // ----- Handle lifecycle -----

    createHandle(): symbol {
        const id = Symbol("smartqtt-handle");
        this.handleEvents.set(id, new TypedEvents<ClientEventMap>());
        this.handleToSubIds.set(id, new Set());
        return id;
    }

    disposeHandle(handleId: symbol): void {
        // Remove all subs for that handle
        const ids = this.handleToSubIds.get(handleId);
        if (ids) {
            for (const subId of Array.from(ids)) {
                this.unsubscribeById(handleId, subId);
            }
        }

        // Remove events for that handle
        this.handleEvents.get(handleId)?.clear();
        this.handleEvents.delete(handleId);
        this.handleToSubIds.delete(handleId);
    }

    on<K extends keyof ClientEventMap>(handleId: symbol, event: K, handler: (e: ClientEventMap[K]) => void): () => void {
        const ev = this.handleEvents.get(handleId);
        if (!ev) throw new Error("Invalid handle");
        return ev.on(event, handler);
    }

    private emitAll<K extends keyof ClientEventMap>(event: K, payload: ClientEventMap[K]): void {
        for (const ev of this.handleEvents.values()) {
            ev.emit(event, payload);
        }
    }

    // ----- Public core state -----

    get connected(): boolean {
        return this.state === "connected";
    }

    // ----- Connect / Disconnect -----

    async connect(): Promise<void> {
        if (this.state === "connected") return;
        if (this.state === "connecting" && this.connectDeferred) return this.connectDeferred.promise;

        this.clearReconnect();
        this.forceCloseRequested = false;
        this.lastCloseHadError = false;
        this.lastCloseWasTimeout = false;

        this.state = "connecting";
        const deferred = new Deferred<void>();
        this.connectDeferred = deferred;

        try {
            await this.openWs();
            this.sendConnect();

            // Timeout for CONNACK
            this.connectTimer = window.setTimeout(() => {
                this.lastCloseWasTimeout = true;
                this.emitAll("error", { error: new Error(`CONNACK timeout after ${this.opts.connectTimeoutMs}ms`) });
                this.disconnect(true);
            }, this.opts.connectTimeoutMs);

            return await deferred.promise;
        } catch (err) {
            this.emitAll("error", { error: err });
            this.disconnect(true);
            throw err;
        }
    }

    disconnect(force = false): void {
        if (this.state === "closed" || this.state === "closing") return;

        this.forceCloseRequested = force;
        this.clearReconnect();
        this.stopKeepAlive();
        this.clearConnectTimer();

        this.state = "closing";

        try {
            if (!force && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.enqueue(disconnectPacket());
            }
        } catch {
            // ignore
        }

        try {
            this.ws?.close();
        } finally {
            this.ws = null;
            this.state = "closed";

            this.failAllPending(new Error("Disconnected"));

            const reason = computeDisconnectReason(this.forceCloseRequested, this.lastCloseWasTimeout, this.lastCloseHadError);
            this.emitAll("disconnect", { reason });

            this.connectDeferred?.reject(new Error("Disconnected"));
            this.connectDeferred = null;
        }
    }

    // ----- Publish -----

    publish(topic: string, payload: string | Uint8Array, opts?: PublishOptions): void {
        const qos = (opts?.qos ?? 0) as QoS;
        if (qos !== 0) {
            throw new Error("SmartQTT core currently supports QoS0 only (frontend-focused).");
        }
        this.ensureWsOpen();
        this.enqueue(publishPacket(topic, normalizePayload(payload), { qos: 0, retain: !!opts?.retain }));
    }

    publishJson(topic: string, value: unknown, opts?: PublishOptions): void {
        this.publish(topic, JSON.stringify(value), opts);
    }

    // ----- Subscribe -----

    subscribe<TPayload>(
        handleId: symbol,
        topicFilter: string,
        handler: SubscriptionHandler<TPayload>,
        qos: QoS,
        decode: DecodeMode
    ): () => void {
        if (!this.handleEvents.has(handleId)) throw new Error("Invalid handle");

        const subId = this.nextSubId++;
        const entry: SubEntry = { id: subId, handleId, handler: handler as SubscriptionHandler<any>, decode };

        const exact = isExactFilter(topicFilter);

        const bucket = exact
            ? this.getOrCreateExact(topicFilter, qos)
            : this.getOrCreateWildcard(topicFilter, qos);

        // If user asks higher QoS than existing bucket, we upgrade request (broker SUBSCRIBE once per filter)
        if (qos > bucket.qos) bucket.qos = qos;

        bucket.entries.push(entry);

        this.subIdToFilter.set(subId, { filter: topicFilter, isExact: exact });
        let set = this.handleToSubIds.get(handleId);
        if (!set) {
            set = new Set();
            this.handleToSubIds.set(handleId, set);
        }
        set.add(subId);

        // Ensure broker subscription is active
        void this.ensureBrokerSubscribed(bucket);

        return () => this.unsubscribeById(handleId, subId);
    }

    private unsubscribeById(handleId: symbol, subId: number): void {
        const meta = this.subIdToFilter.get(subId);
        if (!meta) return;

        const { filter, isExact } = meta;
        const bucket = isExact ? this.exact.get(filter) : this.wildcard.find((b) => b.filter === filter);
        if (!bucket) {
            this.subIdToFilter.delete(subId);
            this.handleToSubIds.get(handleId)?.delete(subId);
            return;
        }

        // Remove entry
        bucket.entries = bucket.entries.filter((e) => e.id !== subId);

        this.subIdToFilter.delete(subId);
        this.handleToSubIds.get(handleId)?.delete(subId);

        // If bucket empty -> UNSUBSCRIBE broker
        if (bucket.entries.length === 0) {
            if (isExact) this.exact.delete(filter);
            else this.wildcard = this.wildcard.filter((b) => b.filter !== filter);

            if (this.connected && bucket.brokerSubscribed) {
                void this.ensureBrokerUnsubscribed(filter);
            }
        }
    }

    // ----- WS / MQTT internals -----

    private async openWs(): Promise<void> {
        const ws = new WebSocket(this.url, this.opts.ws.protocols ?? "mqtt");
        ws.binaryType = "arraybuffer";
        this.ws = ws;

        await new Promise<void>((resolve, reject) => {
            const onOpen = () => {
                cleanup();
                resolve();
            };
            const onErr = () => {
                cleanup();
                reject(new Error("WebSocket connection error"));
            };
            const cleanup = () => {
                ws.removeEventListener("open", onOpen);
                ws.removeEventListener("error", onErr);
            };
            ws.addEventListener("open", onOpen);
            ws.addEventListener("error", onErr);
        });

        ws.addEventListener("message", (ev) => {
            if (!(ev.data instanceof ArrayBuffer)) return;
            this.lastActivityAt = now();
            try {
                this.onData(new Uint8Array(ev.data));
            } catch (err) {
                this.emitAll("error", { error: err });
                this.disconnect(true);
            }
        });

        ws.addEventListener("close", (ev) => {
            // Some browsers do not provide "error" flags; treat clean close vs not via code? Keep simple.
            // If it closes while connecting/connected, we attempt reconnect if referenced.
            void ev;

            this.ws = null;
            this.stopKeepAlive();
            this.clearConnectTimer();
            this.failAllPending(new Error("Socket closed"));

            const reason = computeDisconnectReason(this.forceCloseRequested, this.lastCloseWasTimeout, this.lastCloseHadError);
            this.emitAll("disconnect", { reason });

            // Ensure connect promise fails if it was waiting
            if (this.state === "connecting" && this.connectDeferred) {
                this.connectDeferred.reject(new Error("Socket closed during connect"));
                this.connectDeferred = null;
            }

            // Reconnect if still in use
            if (!this.forceCloseRequested && this.refCount > 0 && this.opts.reconnect.enabled) {
                this.scheduleReconnect();
            } else {
                this.state = "closed";
            }
        });
    }

    private sendConnect(): void {
        this.ensureWsOpen();
        this.lastActivityAt = now();
        this.enqueue(
            connectPacket({
                clientId: this.opts.clientId,
                cleanSession: this.opts.cleanSession,
                keepAliveSec: this.opts.keepAliveSec,
                username: this.opts.username,
                password: this.opts.password
            })
        );
    }

    private onData(chunk: Uint8Array): void {
        const packets = this.parser.push(chunk);

        for (const p of packets) {
            switch (p.type) {
                case 2: { // CONNACK
                    const { sessionPresent, returnCode } = decodeConnack(p.body);
                    if (returnCode !== 0) {
                        this.emitAll("disconnect", { reason: "auth_failed", error: new Error(`CONNACK returnCode=${returnCode}`) });
                        this.disconnect(true);
                        return;
                    }

                    this.clearConnectTimer();
                    this.state = "connected";
                    this.reconnectAttempt = 0;

                    this.startKeepAlive();

                    // Mark broker subscriptions dirty for resubscribe on reconnect
                    for (const b of this.exact.values()) b.brokerSubscribed = false;
                    for (const b of this.wildcard) b.brokerSubscribed = false;

                    // Resubscribe active filters (best-effort; keep it sequential to reduce burst)
                    void this.resubscribeAll().catch((err) => this.emitAll("error", { error: err }));

                    this.emitAll("connect", { sessionPresent });

                    this.connectDeferred?.resolve();
                    this.connectDeferred = null;
                    break;
                }

                case 3: { // PUBLISH
                    const msg = decodePublish(p.flags, p.body);
                    this.dispatchPublish(msg.topic, msg.bytes, msg.qos, msg.retain, msg.dup);
                    break;
                }

                case 9: { // SUBACK
                    const { packetId } = decodeSuback(p.body);
                    const pending = this.pendingSub.get(packetId);
                    if (pending) {
                        clearTimeout(pending.timer);
                        this.pendingSub.delete(packetId);
                        pending.resolve();
                    }
                    break;
                }

                case 11: { // UNSUBACK
                    const { packetId } = decodeUnsuback(p.body);
                    const pending = this.pendingUnsub.get(packetId);
                    if (pending) {
                        clearTimeout(pending.timer);
                        this.pendingUnsub.delete(packetId);
                        pending.resolve();
                    }
                    break;
                }

                case 13: { // PINGRESP
                    this.pingOutstanding = false;
                    if (this.pingTimeoutTimer != null) {
                        clearTimeout(this.pingTimeoutTimer);
                        this.pingTimeoutTimer = null;
                    }
                    break;
                }

                default:
                    // ignore in this core
                    break;
            }
        }
    }

    private dispatchPublish(topic: string, bytes: Uint8Array, qos: QoS, retain: boolean, dup: boolean): void {
        // Fast path: exact match
        const exactBucket = this.exact.get(topic);
        if (exactBucket) {
            this.dispatchToBucket(exactBucket, topic, bytes, qos, retain, dup);
        }

        // Wildcards
        if (this.wildcard.length) {
            for (const b of this.wildcard) {
                if (!matchTopic(b.filter, topic)) continue;
                this.dispatchToBucket(b, topic, bytes, qos, retain, dup);
            }
        }
    }

    private dispatchToBucket(bucket: FilterBucket, topic: string, bytes: Uint8Array, qos: QoS, retain: boolean, dup: boolean): void {
        if (!bucket.entries.length) return;

        // Cache decodes per message per bucket dispatch
        let utf8Cache: string | null = null;
        let jsonCache: any = undefined;
        let jsonParsed = false;

        const customCache = new Map<Function, any>();

        for (const entry of bucket.entries) {
            let payload: any;

            if (entry.decode === "binary") {
                payload = bytes;
            } else if (entry.decode === "utf8") {
                if (utf8Cache === null) utf8Cache = decodeUtf8(bytes);
                payload = utf8Cache;
            } else if (entry.decode === "json") {
                if (!jsonParsed) {
                    if (utf8Cache === null) utf8Cache = decodeUtf8(bytes);
                    jsonCache = JSON.parse(utf8Cache);
                    jsonParsed = true;
                }
                payload = jsonCache;
            } else if (typeof entry.decode === "function") {
                const fn = entry.decode;
                if (customCache.has(fn)) payload = customCache.get(fn);
                else {
                    payload = fn(bytes, topic);
                    customCache.set(fn, payload);
                }
            } else {
                // fallback
                if (utf8Cache === null) utf8Cache = decodeUtf8(bytes);
                payload = utf8Cache;
            }

            const message: IncomingMessage<any> = { topic, payload, bytes, qos, retain, dup };

            try {
                entry.handler(message);
            } catch (err) {
                this.emitAll("error", { error: err });
            }
        }
    }

    // ----- Broker subscribe/unsubscribe -----

    private getOrCreateExact(filter: string, qos: QoS): FilterBucket {
        let b = this.exact.get(filter);
        if (!b) {
            b = { filter, qos, entries: [], brokerSubscribed: false };
            this.exact.set(filter, b);
        }
        return b;
    }

    private getOrCreateWildcard(filter: string, qos: QoS): FilterBucket {
        let b = this.wildcard.find((x) => x.filter === filter);
        if (!b) {
            b = { filter, qos, entries: [], brokerSubscribed: false };
            this.wildcard.push(b);
        }
        return b;
    }

    private async ensureBrokerSubscribed(bucket: FilterBucket): Promise<void> {
        if (!this.connected) return;
        if (bucket.brokerSubscribed) return;

        await this.sendSubscribe(bucket.filter, bucket.qos);
        bucket.brokerSubscribed = true;
    }

    private async ensureBrokerUnsubscribed(filter: string): Promise<void> {
        if (!this.connected) return;
        await this.sendUnsubscribe(filter);
    }

    private async resubscribeAll(): Promise<void> {
        if (!this.connected) return;

        for (const b of this.exact.values()) {
            if (b.entries.length) {
                await this.ensureBrokerSubscribed(b);
            }
        }
        for (const b of this.wildcard) {
            if (b.entries.length) {
                await this.ensureBrokerSubscribed(b);
            }
        }
    }

    private sendSubscribe(filter: string, qos: QoS): Promise<void> {
        this.ensureWsOpen();

        const pid = this.allocPacketId();
        const pkt = subscribePacket(pid, [{ topic: filter, qos }]);

        const timeoutMs = Math.max(1000, this.opts.connectTimeoutMs);

        return new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.pendingSub.delete(pid);
                reject(new Error(`SUBACK timeout (packetId=${pid})`));
            }, timeoutMs);

            this.pendingSub.set(pid, { resolve, reject, timer });
            this.enqueue(pkt);
        });
    }

    private sendUnsubscribe(filter: string): Promise<void> {
        this.ensureWsOpen();

        const pid = this.allocPacketId();
        const pkt = unsubscribePacket(pid, [filter]);

        const timeoutMs = Math.max(1000, this.opts.connectTimeoutMs);

        return new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.pendingUnsub.delete(pid);
                reject(new Error(`UNSUBACK timeout (packetId=${pid})`));
            }, timeoutMs);

            this.pendingUnsub.set(pid, { resolve, reject, timer });
            this.enqueue(pkt);
        });
    }

    // ----- Keepalive -----

    private startKeepAlive(): void {
        this.stopKeepAlive();
        if (this.opts.keepAliveSec <= 0) return;

        const intervalMs = Math.max(1000, Math.floor((this.opts.keepAliveSec * 1000) / 2));
        this.keepAliveTimer = window.setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            if (!this.connected) return;

            const idle = now() - this.lastActivityAt;
            if (idle < intervalMs) return;

            if (this.pingOutstanding) return;

            this.pingOutstanding = true;
            this.enqueue(pingreqPacket());

            this.pingTimeoutTimer = window.setTimeout(() => {
                if (!this.pingOutstanding) return;
                this.lastCloseWasTimeout = true;
                this.disconnect(true);
            }, this.opts.pingTimeoutMs);
        }, intervalMs);
    }

    private stopKeepAlive(): void {
        if (this.keepAliveTimer != null) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
        if (this.pingTimeoutTimer != null) {
            clearTimeout(this.pingTimeoutTimer);
            this.pingTimeoutTimer = null;
        }
        this.pingOutstanding = false;
    }

    // ----- Reconnect -----

    private scheduleReconnect(): void {
        this.clearReconnect();

        const delay = backoff(
            this.reconnectAttempt++,
            this.opts.reconnect.minDelayMs,
            this.opts.reconnect.maxDelayMs,
            this.opts.reconnect.jitterRatio
        );

        this.emitAll("reconnect", { attempt: this.reconnectAttempt, delayMs: delay });

        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect().catch(() => this.scheduleReconnect());
        }, delay);
    }

    private clearReconnect(): void {
        if (this.reconnectTimer != null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    // ----- Outgoing queue -----

    private enqueue(data: Uint8Array): void {
        const max = this.opts.maxQueueBytes;
        if (this.outBytes + data.length > max) throw new Error(`Outgoing queue overflow (> ${max} bytes)`);

        this.outQ.push(data);
        this.outBytes += data.length;
        void this.flush();
    }

    private async flush(): Promise<void> {
        if (this.flushing) return;
        this.flushing = true;

        try {
            const ws = this.ws;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            const HIGH_WATER = 1_000_000; // 1MB
            while (this.outQ.length) {
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

                if (ws.bufferedAmount > HIGH_WATER) {
                    await new Promise<void>((r) => setTimeout(r, 0));
                    continue;
                }

                const pkt = this.outQ.shift()!;
                this.outBytes -= pkt.length;
                ws.send(pkt);
                this.lastActivityAt = now();
            }
        } finally {
            this.flushing = false;
        }
    }

    // ----- Helpers -----

    private ensureWsOpen(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error("WebSocket is not open. Call connect() first (or enable autoConnect).");
        }
    }

    private allocPacketId(): number {
        const pid = this.nextPacketId++;
        if (this.nextPacketId > 0xffff) this.nextPacketId = 1;
        return pid;
    }

    private clearConnectTimer(): void {
        if (this.connectTimer != null) {
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }
    }

    private failAllPending(err: Error): void {
        for (const [, p] of this.pendingSub) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        for (const [, p] of this.pendingUnsub) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pendingSub.clear();
        this.pendingUnsub.clear();
    }
}
