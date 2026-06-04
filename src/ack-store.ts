import type { PropagationRedisClient } from "./types.js";

// In-flight book-keeping for outbound publishes that wait for an ACK from the target.
// Layout:
//   propagation:ack:<eventId>            HSET { clientId, targetAmqpQueue, attemptCount, sentAt }  TTL 7d
//   propagation:client-pending:<clientId> SET of pending eventIds                                  TTL 7d
//   propagation:client-results:<clientId> HSET { targetAmqpQueue -> "success" | "error" }          TTL 7d
//
// A separate per-client set and per-client result hash makes it cheap to decide when
// a clientId is "fully propagated" (set is empty) and what finalStatus to report.

const TTL_SECONDS = 7 * 24 * 3600;

const ACK_KEY_PREFIX = "propagation:ack";
const CLIENT_PENDING_PREFIX = "propagation:client-pending";
const CLIENT_RESULTS_PREFIX = "propagation:client-results";

export interface AckRecord {
  clientId: string;
  targetAmqpQueue: string;
  attemptCount: number;
  sentAt: number;
}

function ackKey(eventId: string) {
  return `${ACK_KEY_PREFIX}:${eventId}`;
}

function pendingKey(clientId: string) {
  return `${CLIENT_PENDING_PREFIX}:${clientId}`;
}

function resultsKey(clientId: string) {
  return `${CLIENT_RESULTS_PREFIX}:${clientId}`;
}

export async function recordPublishedEvent(redis: PropagationRedisClient, eventId: string, record: AckRecord) {
  await redis.hSet(ackKey(eventId), {
    clientId: record.clientId,
    targetAmqpQueue: record.targetAmqpQueue,
    attemptCount: String(record.attemptCount),
    sentAt: String(record.sentAt),
  });
  await redis.expire(ackKey(eventId), TTL_SECONDS);
  await redis.sAdd(pendingKey(record.clientId), eventId);
  await redis.expire(pendingKey(record.clientId), TTL_SECONDS);
}

export async function readPublishedEvent(redis: PropagationRedisClient, eventId: string): Promise<AckRecord | null> {
  const raw = await redis.hGetAll(ackKey(eventId));
  if (!raw || Object.keys(raw).length === 0) return null;
  const attemptCount = Number(raw.attemptCount);
  const sentAt = Number(raw.sentAt);
  if (
    typeof raw.clientId !== "string" ||
    raw.clientId.length === 0 ||
    typeof raw.targetAmqpQueue !== "string" ||
    raw.targetAmqpQueue.length === 0 ||
    !Number.isFinite(attemptCount) ||
    !Number.isFinite(sentAt)
  ) {
    return null;
  }
  return { clientId: raw.clientId, targetAmqpQueue: raw.targetAmqpQueue, attemptCount, sentAt };
}

export async function recordTargetResult(
  redis: PropagationRedisClient,
  clientId: string,
  targetAmqpQueue: string,
  result: "success" | "error",
  eventId: string
) {
  await redis.hSet(resultsKey(clientId), { [targetAmqpQueue]: result });
  await redis.expire(resultsKey(clientId), TTL_SECONDS);
  await redis.sRem(pendingKey(clientId), eventId);
  await redis.del(ackKey(eventId));
}

export async function pendingCountForClient(redis: PropagationRedisClient, clientId: string) {
  return redis.sCard(pendingKey(clientId));
}

export async function readClientResults(redis: PropagationRedisClient, clientId: string) {
  const raw = await redis.hGetAll(resultsKey(clientId));
  return raw ?? {};
}

export async function clearClientAggregates(redis: PropagationRedisClient, clientId: string) {
  await redis.del(pendingKey(clientId));
  await redis.del(resultsKey(clientId));
}

export function aggregateFinalStatus(results: Record<string, string>): "success" | "partial" | "error" {
  const values = Object.values(results);
  if (values.length === 0) return "success";
  const hasSuccess = values.includes("success");
  const hasError = values.includes("error");
  if (hasSuccess && !hasError) return "success";
  if (hasError && !hasSuccess) return "error";
  return "partial";
}
