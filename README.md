# SmartQTT

A modern, frontend-first **MQTT over WebSocket** client written in TypeScript.

SmartQTT is designed for web applications where you need a **simple API**, **high performance**, and **minimal dependencies** (zero runtime deps). It also supports **shared connections** by default to avoid creating multiple sockets across different parts of your app.

## Features

- Frontend-first MQTT client (MQTT **3.1.1** over **WebSocket**)
- Very small and simple API: `connect`, `subscribe`, `publish`, `dispose`
- Decoded payloads by default (UTF-8 string), with optional JSON/binary/custom decoding per subscription
- Shared physical connection by default (prevents “too many connections” issues in large apps)
- Keepalive (PINGREQ/PINGRESP), automatic reconnect with backoff, resubscribe on reconnect
- Authentication via MQTT CONNECT `username` / `password`
- Zero runtime dependencies

## Installation

```bash
pnpm add smartqtt
# or
npm i smartqtt
# or
yarn add smartqtt
```
## Quick start
```ts
import { smartqtt } from "smartqtt";

const mqtt = smartqtt("wss://broker.example.com/mqtt", {
  clientId: "webapp",
  autoConnect: true
});

mqtt.subscribe("app/#", (msg) => {
  // msg.payload is a decoded string by default
  console.log(msg.topic, msg.payload);
});

mqtt.publish("app/refresh", "now");

// later
mqtt.dispose(); // unsubscribes everything for this handle + closes/release socket
```
## Authentication and security
SmartQTT supports MQTT CONNECT credentials:

```ts
const mqtt = smartqtt("wss://broker.example.com/mqtt", {
  clientId: "webapp",
  username: "user-or-token",
  password: "secret-or-token"
});
```
> Use wss:// in production for TLS encryption.

### API
```smartqtt(url, options)```

Creates a SmartQTT client handle.

```ts
const mqtt = smartqtt("wss://broker.example.com/mqtt", {
  clientId: "my-app"
});
```

### Options

-   `clientId`  (required): MQTT client identifier
-   `username`, `password`: MQTT CONNECT credentials
-   `autoConnect`  (default: `true`)
-   `cleanSession`  (default: `true`)
-   `keepAliveSec`  (default: `60`)
-   `pingTimeoutMs`  (default: `10000`)
    
-   `connectTimeoutMs`  (default: `10000`)
    
-   `reconnect`  (object):
    
    -   `enabled`  (default: `true`)
        
    -   `minDelayMs`  (default: `250`)
        
    -   `maxDelayMs`  (default: `10000`)
        
    -   `jitterRatio`  (default: `0.2`)
        
-   `shared`  (default: `true`): share a physical connection
    
-   `sharedKey`: override the sharing key
    
-   `maxQueueBytes`  (default: `5MB`)
    
-   `ws.protocols`  (default: `"mqtt"`)


## `connect()`

Establishes the WebSocket and completes the MQTT CONNECT/CONNACK handshake.


```ts
await mqtt.connect();
```

If `autoConnect: true`, you can still call `connect()` to await readiness.

## `subscribe(topicFilter, handler, options?)`

Subscribe to a topic filter. Returns an unsubscribe function.


```ts
const off = mqtt.subscribe("app/#", (msg) => {
  console.log(msg.payload);
});
// stop listening (without disconnecting)
off();
```

### Subscribe options

-   `qos` (default: `0`)
    
-   `decode` (default: `"utf8"`):
    
    -   `"utf8"` → string
        
    -   `"json"` → parsed JSON
        
    -   `"binary"` → `Uint8Array`
        
    -   `(bytes, topic) => any` → custom decoder
        

#### Examples

```ts
// JSON payloads
mqtt.subscribe("data/#", (msg) => {
  console.log(msg.payload.someField);
}, { decode: "json" });

// Binary payloads
mqtt.subscribe("bin/#", (msg) => {
  console.log(msg.payload); // Uint8Array
}, { decode: "binary" });

// Custom decode
mqtt.subscribe("custom/#", (msg) => {
  console.log(msg.payload);
}, { decode: (bytes) => bytes.length });

```

## `publish(topic, payload, options?)`

```ts
mqtt.publish("app/refresh", "now");
mqtt.publish("app/raw", new Uint8Array([1, 2, 3]));
```

### Publish options

-   `qos` (default: `0`)
    
-   `retain` (default: `false`)
    

## `publishJson(topic, value, options?)`

Convenience wrapper around `JSON.stringify()`:

```ts
mqtt.publishJson("data/update", { ok: true });
```

## `dispose()` / `disconnect()`

Releases the client handle.

```ts
mqtt.dispose();    // preferred
mqtt.disconnect(); // alias
```

-   Removes all subscriptions for this handle
    
-   If `shared: true`, releases the shared socket (closes when no handles remain)
    
-   If `shared: false`, closes immediately
    

## Events

```ts
const off = mqtt.on("connect", (e) =>
  console.log("connected", e.sessionPresent)
);

mqtt.on("disconnect", (e) =>
  console.log("disconnected", e.reason)
);

mqtt.on("reconnect", (e) =>
  console.log("reconnect attempt", e.attempt, "delay", e.delayMs)
);

mqtt.on("error", (e) =>
  console.error("error", e.error)
);
```

### Available events

-   **connect** — MQTT connection established
    
-   **disconnect** — connection ended
    
-   **reconnect** — reconnect scheduled
    
-   **error** — internal error surfaced
## License
MIT