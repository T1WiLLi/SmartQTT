export function isExactFilter(filter: string): boolean {
    return filter.indexOf("+") === -1 && filter.indexOf("#") === -1;
}

/**
 * MQTT topic filter matching for + and #.
 * - + matches exactly one level
 * - # matches remaining levels (must be last)
 */
export function matchTopic(filter: string, topic: string): boolean {
    if (filter === topic) {
        return true;
    }

    const f = filter.split("/");
    const t = topic.split("/");

    for (let i = 0; i < f.length; i++) {
        const fp = f[i]!;

        if (fp === "#") {
            return i === f.length - 1;
        }

        if (i >= t.length) {
            return false;
        }

        if (fp === "+") {
            continue;
        }

        if (fp !== t[i]) {
            return false;
        }
    }

    return f.length === t.length;
}
