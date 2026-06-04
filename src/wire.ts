import { timingSafeEqual } from "node:crypto";
import type { AckEvent, AnyEvent, ApplyEvent, PropagationOp, PropagationTrack } from "./types.js";

// Queue naming. Non-negotiable: prefix "hmac-" + suffix ".queue".
export function buildQueueName(amqpQueue: string) {
  if (!/^[A-Za-z0-9-]+$/.test(amqpQueue)) {
    throw new Error(`Invalid amqpQueue "${amqpQueue}": must match [A-Za-z0-9-]+`);
  }
  return `hmac-${amqpQueue}.queue`;
}

export const DEFAULT_AMQP_VHOST = "hmac-credentials";

// Serialize and parse with a canonical field order so the JSON is stable across runtimes.
export function encodeApplyEvent(event: ApplyEvent): Buffer {
  return Buffer.from(JSON.stringify(event), "utf8");
}

export function encodeAckEvent(event: AckEvent): Buffer {
  return Buffer.from(JSON.stringify(event), "utf8");
}

export function decodeEvent(raw: Buffer | string): AnyEvent {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const parsed = JSON.parse(text) as AnyEvent;
  assertWellFormedEvent(parsed);
  return parsed;
}

function assertWellFormedEvent(event: AnyEvent) {
  if (typeof event !== "object" || event === null) {
    throw new Error("Event is not an object");
  }
  if (typeof event.eventId !== "string" || event.eventId.length === 0) {
    throw new Error("Event has no eventId");
  }
  if (typeof event.ts !== "number" || !Number.isFinite(event.ts)) {
    throw new Error("Event has no valid ts");
  }
  if (typeof event.propagationSecret !== "string") {
    throw new Error("Event has no propagationSecret");
  }
  if (typeof event.senderAmqpQueue !== "string" || event.senderAmqpQueue.length === 0) {
    throw new Error("Event has no senderAmqpQueue");
  }
  if (typeof event.op !== "string") {
    throw new Error("Event has no op");
  }
}

export function isAckEvent(event: AnyEvent): event is AckEvent {
  return event.op === "credential.ack";
}

export function isApplyEvent(event: AnyEvent): event is ApplyEvent {
  return event.op === "credential.create" || event.op === "credential.update" || event.op === "credential.delete";
}

// Constant time compare. Returns false on length mismatch without leaking the difference.
export function propagationSecretMatches(received: string, expected: string) {
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const APPLY_OPS: readonly PropagationOp[] = ["credential.create", "credential.update", "credential.delete"];

export const TRACKS: readonly PropagationTrack[] = ["http", "message"];
