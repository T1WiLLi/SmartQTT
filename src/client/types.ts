export type QoS = 0 | 1 | 2;

export type DecodeMode =
    | "utf8"
    | "binary"
    | "json"
    | ((bytes: Uint8Array, topic: string) => any);

export type SmartQTTOptions = {
    clientId: string;
    username?: string;
    password?: string;
    autoConnect?: boolean;
    cleanSession?: boolean;
    keepAliveSec?: number;
    pingTimeoutMs?: number;
    connectTimeoutMs?: number;
    reconnect?: {
        enabled: boolean;
        minDelayMs?: number;
        maxDelayMs?: number;
        jitterRatio?: number;
    };
    shared?: boolean;
    sharedKey?: string;
    maxQueueBytes?: number;
    ws?: {
        protocols?: string | string[];
    };
};

export type ResolvedSmartQTTOptions = {
    clientId: string;
    username?: string;
    password?: string;
    autoConnect: boolean;
    cleanSession: boolean;
    keepAliveSec: number;
    pingTimeoutMs: number;
    connectTimeoutMs: number;
    reconnect: {
        enabled: boolean;
        minDelayMs: number;
        maxDelayMs: number;
        jitterRatio: number;
    };
    shared: boolean;
    sharedKey: string;
    maxQueueBytes: number;
    ws: {
        protocols: string | string[];
    };
};

export type IncomingMessage<TPayload = string> = {
    topic: string;
    payload: TPayload;
    bytes: Uint8Array;
    qos: QoS;
    retain: boolean;
    dup: boolean;
};

export type SubscriptionHandler<TPayload = string> = (msg: IncomingMessage<TPayload>) => void;

export type SubscribeOptions = {
    qos?: QoS;
    decode?: DecodeMode;
};

export type PublishOptions = {
    qos?: QoS;
    retain?: boolean;
};

export type DisconnectReason =
    | "requested"
    | "socket_closed"
    | "timeout"
    | "protocol_error"
    | "auth_failed"
    | "error";

export type ClientEventMap = {
    connect: { sessionPresent: boolean };
    reconnect: { attempt: number; delayMs: number };
    disconnect: { reason: DisconnectReason; error?: unknown };
    error: { error: unknown };
};

export type SmartQTTClient = {
    readonly connected: boolean;
    connect(): Promise<void>;
    dispose(): void;
    disconnect(): void;
    publish(topic: string, payload: string | Uint8Array, opts?: PublishOptions): void;
    publishJson(topic: string, value: unknown, opts?: PublishOptions): void;
    subscribe<TPayload = string>(
        topicFilter: string,
        handler: SubscriptionHandler<TPayload>,
        opts?: SubscribeOptions
    ): () => void;

    on<K extends keyof ClientEventMap>(event: K, handler: (e: ClientEventMap[K]) => void): () => void;
};
