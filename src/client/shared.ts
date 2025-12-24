import type { ResolvedSmartQTTOptions } from "./types";
import { SmartQTTCore } from "./core";

type CoreEntry = { core: SmartQTTCore };

const registry = new Map<string, CoreEntry>();

export function getSharedCore(url: string, opts: ResolvedSmartQTTOptions): SmartQTTCore {
    const key =
        opts.sharedKey && opts.sharedKey.length > 0
            ? opts.sharedKey
            : `${url}::${opts.clientId}::${opts.username ?? ""}`;

    let entry = registry.get(key);
    if (!entry) {
        entry = { core: new SmartQTTCore(url, opts) };
        registry.set(key, entry);
    }

    entry.core.addRef();
    return entry.core;
}

export function releaseSharedCore(core: SmartQTTCore): void {
    core.release();
}
