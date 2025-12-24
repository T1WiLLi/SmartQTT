import type {
    SmartQTTClient,
    SmartQTTOptions,
    SubscriptionHandler,
    QoS,
    SubscribeOptions,
    PublishOptions,
    ClientEventMap,
    ResolvedSmartQTTOptions
} from "./types.js";
import { getSharedCore, releaseSharedCore } from "./shared";
import { SmartQTTCore } from "./core";

function withDefaults(opts: SmartQTTOptions): ResolvedSmartQTTOptions {
    return {
        clientId: opts.clientId,
        username: opts.username,
        password: opts.password,

        autoConnect: opts.autoConnect ?? true,
        cleanSession: opts.cleanSession ?? true,

        keepAliveSec: opts.keepAliveSec ?? 60,
        pingTimeoutMs: opts.pingTimeoutMs ?? 10_000,
        connectTimeoutMs: opts.connectTimeoutMs ?? 10_000,

        reconnect: {
            enabled: opts.reconnect?.enabled ?? true,
            minDelayMs: opts.reconnect?.minDelayMs ?? 250,
            maxDelayMs: opts.reconnect?.maxDelayMs ?? 10_000,
            jitterRatio: opts.reconnect?.jitterRatio ?? 0.2
        },

        shared: opts.shared ?? true,
        sharedKey: opts.sharedKey ?? "",

        maxQueueBytes: opts.maxQueueBytes ?? 5 * 1024 * 1024,

        ws: {
            protocols: opts.ws?.protocols ?? "mqtt"
        }
    };
}

export function smartqtt(url: string, options: SmartQTTOptions): SmartQTTClient {
    const opts = withDefaults(options);

    const core = opts.shared ? getSharedCore(url, opts) : new SmartQTTCore(url, opts);
    const handleId = core.createHandle();

    if (opts.autoConnect) {
        void core.connect().catch(() => {
            // reconnect loop handles it when enabled;
        });
    }

    const dispose = () => {
        core.disposeHandle(handleId);
        if (opts.shared) releaseSharedCore(core);
        else core.disconnect(false);
    };

    return {
        get connected() {
            return core.connected;
        },

        connect() {
            return core.connect();
        },

        dispose,
        disconnect: dispose,

        publish(topic: string, payload: string | Uint8Array, pOpts?: PublishOptions) {
            core.publish(topic, payload, pOpts);
        },

        publishJson(topic: string, value: unknown, pOpts?: PublishOptions) {
            core.publishJson(topic, value, pOpts);
        },

        subscribe<TPayload = string>(topicFilter: string, handler: SubscriptionHandler<TPayload>, sOpts?: SubscribeOptions) {
            const qos = (sOpts?.qos ?? 0) as QoS;
            const decode = sOpts?.decode ?? "utf8";
            return core.subscribe<TPayload>(handleId, topicFilter, handler, qos, decode);
        },

        on<K extends keyof ClientEventMap>(event: K, handler: (e: ClientEventMap[K]) => void) {
            return core.on(handleId, event, handler);
        }
    };
}
