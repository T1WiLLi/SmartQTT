import { describe, expect, it } from "vitest";
import { isExactFilter, matchTopic } from "../src/util/topic-match";

describe("topic matching", () => {
    it("detects exact filters", () => {
        expect(isExactFilter("a/b/c")).toBe(true);
        expect(isExactFilter("a/+/c")).toBe(false);
        expect(isExactFilter("a/#")).toBe(false);
    });

    it("matches topics using MQTT wildcards", () => {
        const cases = [
            { filter: "sensors/+/temp", topic: "sensors/123/temp", match: true },
            { filter: "sensors/+/temp", topic: "sensors/123/humidity", match: false },
            { filter: "home/#", topic: "home/kitchen/temp", match: true },
            { filter: "home/#", topic: "factory/kitchen/temp", match: false },
            { filter: "#", topic: "anything/goes/here", match: true },
            { filter: "a/b", topic: "a/b/c", match: false },
            { filter: "a/+/c", topic: "a/b/c", match: true },
            { filter: "a/+/c", topic: "a/b/c/d", match: false },
            { filter: "#/a", topic: "x", match: false }
        ];

        for (const c of cases) {
            expect(matchTopic(c.filter, c.topic)).toBe(c.match);
        }
    });
});

