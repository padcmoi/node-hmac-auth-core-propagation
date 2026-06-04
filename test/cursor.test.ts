import { describe, expect, it } from "vitest";
import { isStrictlyNewer, readCursor, writeCursor } from "../src/cursor.js";
import { makeFakeRedis } from "./helpers/fake-redis.js";

describe("cursor", () => {
  it("null current means any incoming is strictly newer", () => {
    expect(isStrictlyNewer(null, { ts: 1, eventId: "a" })).toBe(true);
  });

  it("higher ts is strictly newer", () => {
    expect(isStrictlyNewer({ ts: 10, eventId: "z" }, { ts: 11, eventId: "a" })).toBe(true);
  });

  it("lower ts is not strictly newer", () => {
    expect(isStrictlyNewer({ ts: 10, eventId: "a" }, { ts: 9, eventId: "z" })).toBe(false);
  });

  it("equal ts falls back to lexicographic eventId comparison", () => {
    expect(isStrictlyNewer({ ts: 10, eventId: "a" }, { ts: 10, eventId: "b" })).toBe(true);
    expect(isStrictlyNewer({ ts: 10, eventId: "b" }, { ts: 10, eventId: "a" })).toBe(false);
    expect(isStrictlyNewer({ ts: 10, eventId: "a" }, { ts: 10, eventId: "a" })).toBe(false);
  });

  it("read/write round-trips through redis", async () => {
    const redis = makeFakeRedis();
    expect(await readCursor(redis, "http", "client_demo")).toBeNull();
    await writeCursor(redis, "http", "client_demo", { ts: 42, eventId: "abc" });
    expect(await readCursor(redis, "http", "client_demo")).toEqual({ ts: 42, eventId: "abc" });
    expect(await readCursor(redis, "message", "client_demo")).toBeNull();
  });
});
