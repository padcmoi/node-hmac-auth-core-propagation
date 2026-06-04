import { describe, expect, it } from "vitest";
import {
  aggregateFinalStatus,
  clearClientAggregates,
  pendingCountForClient,
  readClientResults,
  readPublishedEvent,
  recordPublishedEvent,
  recordTargetResult,
} from "../src/ack-store.js";
import { makeFakeRedis } from "./helpers/fake-redis.js";

describe("ack-store", () => {
  it("records and reads a published event", async () => {
    const redis = makeFakeRedis();
    await recordPublishedEvent(redis, "ev-1", {
      clientId: "client_demo",
      targetAmqpQueue: "x-ged-extract-mistral",
      attemptCount: 1,
      sentAt: 1000,
    });
    expect(await readPublishedEvent(redis, "ev-1")).toEqual({
      clientId: "client_demo",
      targetAmqpQueue: "x-ged-extract-mistral",
      attemptCount: 1,
      sentAt: 1000,
    });
    expect(await pendingCountForClient(redis, "client_demo")).toBe(1);
  });

  it("resolves a target result and decrements pending count", async () => {
    const redis = makeFakeRedis();
    await recordPublishedEvent(redis, "ev-a", { clientId: "c", targetAmqpQueue: "A", attemptCount: 1, sentAt: 100 });
    await recordPublishedEvent(redis, "ev-b", { clientId: "c", targetAmqpQueue: "B", attemptCount: 1, sentAt: 100 });
    expect(await pendingCountForClient(redis, "c")).toBe(2);

    await recordTargetResult(redis, "c", "A", "success", "ev-a");
    expect(await pendingCountForClient(redis, "c")).toBe(1);
    expect(await readPublishedEvent(redis, "ev-a")).toBeNull();

    await recordTargetResult(redis, "c", "B", "error", "ev-b");
    expect(await pendingCountForClient(redis, "c")).toBe(0);

    expect(await readClientResults(redis, "c")).toEqual({ A: "success", B: "error" });
  });

  it("aggregateFinalStatus computes success/partial/error", () => {
    expect(aggregateFinalStatus({})).toBe("success");
    expect(aggregateFinalStatus({ A: "success" })).toBe("success");
    expect(aggregateFinalStatus({ A: "success", B: "success" })).toBe("success");
    expect(aggregateFinalStatus({ A: "error", B: "error" })).toBe("error");
    expect(aggregateFinalStatus({ A: "success", B: "error" })).toBe("partial");
  });

  it("clearClientAggregates wipes pending set and results hash", async () => {
    const redis = makeFakeRedis();
    await recordPublishedEvent(redis, "e", { clientId: "c", targetAmqpQueue: "T", attemptCount: 1, sentAt: 1 });
    await recordTargetResult(redis, "c", "T", "success", "e");
    expect(await pendingCountForClient(redis, "c")).toBe(0);
    expect(await readClientResults(redis, "c")).toEqual({ T: "success" });
    await clearClientAggregates(redis, "c");
    expect(await readClientResults(redis, "c")).toEqual({});
  });
});
