import type { InitializedHmacHttpAuth, InitializedHmacMessageAuth } from "@naskot/node-hmac-auth-core";

// Subset of node-redis v4+ surface that the propagation lib needs for its monotonic
// cursor and ack store. node-redis v4+ exposes camelCase by default. Any client with
// the same shape (ioredis behind a shim, mocks, etc.) works.
export interface PropagationRedisClient {
  hGet: (key: string, field: string) => Promise<string | null | undefined>;
  hSet: (key: string, fields: Record<string, string>) => Promise<unknown>;
  hGetAll: (key: string) => Promise<Record<string, string>>;
  hDel: (key: string, field: string | string[]) => Promise<unknown>;
  sAdd: (key: string, member: string | string[]) => Promise<unknown>;
  sRem: (key: string, member: string | string[]) => Promise<unknown>;
  sCard: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  del: (key: string | string[]) => Promise<unknown>;
}

export type PropagationTrack = "http" | "message";

export type PropagationOp = "credential.create" | "credential.update" | "credential.delete";

export type PropagationAckOp = "credential.ack";

export type AckResult = "applied" | "error";

// Inputs passed by the lib to management callbacks.
export interface UpsertInput {
  clientId: string;
  track: PropagationTrack;
  op: PropagationOp;
  secretPlain: string | null;
  allowedIps?: string[];
  expiresAt?: number | null;
  targets: string[];
}

export interface RotateInput {
  clientId: string;
  track: PropagationTrack;
  secretPlain: string;
}

export interface TargetSentInput {
  clientId: string;
  targetAmqpQueue: string;
  sentAt: number;
  attemptCount: number;
}

export interface TargetSuccessInput {
  clientId: string;
  targetAmqpQueue: string;
  appliedAt: number;
}

export interface TargetErrorInput {
  clientId: string;
  targetAmqpQueue: string;
  reason: string;
  failedAt: number;
}

export interface FullyPropagatedInput {
  clientId: string;
  finalStatus: "success" | "partial" | "error";
  at: number;
}

// Returns expected from management callbacks.
export interface PendingPropagation {
  clientId: string;
  track: PropagationTrack;
  op: PropagationOp;
  secretPlain: string | null;
  allowedIps?: string[];
  expiresAt?: number | null;
  pendingTargets: Array<{
    targetAmqpQueue: string;
    propagationSecret: string;
  }>;
}

// The 8 callbacks the lib needs from the consumer in full mode.
export interface PropagatorManagement {
  upsertCredentialWithTargets: (input: UpsertInput) => Promise<void>;
  rotateCredentialSecret: (input: RotateInput) => Promise<void>;
  markTargetSent: (input: TargetSentInput) => Promise<void>;
  markTargetSuccess: (input: TargetSuccessInput) => Promise<void>;
  markTargetError: (input: TargetErrorInput) => Promise<void>;
  markCredentialFullyPropagated: (input: FullyPropagatedInput) => Promise<void>;
  fetchPendingPropagations: () => Promise<PendingPropagation[]>;
  fetchSourcePropagationSecret: (senderAmqpQueue: string) => Promise<string | null>;
}

export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface PropagatorOptions {
  // AMQP connection. The lib drives RabbitMQ internally and never exposes a channel.
  amqpHost: string;
  amqpPort: number;
  amqpUser: string;
  amqpPassword: string;
  amqpProtocol: "amqp" | "amqps";
  amqpVhost?: "hmac-credentials";
  amqpQueue: string;

  // The peer's own env propagationSecret, used to verify inbound events.
  propagationSecret: string;

  // Redis client used for the monotonic cursor and the ack store.
  redis: PropagationRedisClient;

  // At least one of the two must be provided.
  hmacHttpAuth?: InitializedHmacHttpAuth;
  hmacMessageAuth?: InitializedHmacMessageAuth;

  // Without management, the lib runs in receive-only mode.
  management?: PropagatorManagement;

  logger?: Logger;
}

// Inputs for the high level helpers exposed on the propagator instance.
export interface EnsureInput {
  clientId: string;
  secret: string;
  targets: string[];
  track?: PropagationTrack;
  allowedIps?: string[];
  expiresAt?: number | null;
}

export interface RotateInputUsage {
  clientId: string;
  secret: string;
  track?: PropagationTrack;
}

export interface RevokeInput {
  clientId: string;
  targets: string[];
  track?: PropagationTrack;
}

export interface SyncSummary {
  propagationsRead: number;
  targetsPublished: number;
  targetsRetrying: number;
  durationMs: number;
}

export interface Propagator {
  close: () => Promise<void>;
  ensure: (input: EnsureInput) => Promise<{ clientId: string; op: "credential.create" | "credential.update" }>;
  rotate: (input: RotateInputUsage) => Promise<{ clientId: string }>;
  revoke: (input: RevokeInput) => Promise<{ clientId: string }>;
  sync: () => Promise<SyncSummary>;
}

// Wire shapes, frozen v1.
export interface ApplyEvent {
  eventId: string;
  ts: number;
  propagationSecret: string;
  senderAmqpQueue: string;
  op: PropagationOp;
  track: PropagationTrack;
  clientId: string;
  payload: {
    secretHash: string;
    allowedIps?: string[];
    expiresAt?: number | null;
  };
}

export interface AckEvent {
  eventId: string;
  ts: number;
  propagationSecret: string;
  senderAmqpQueue: string;
  op: PropagationAckOp;
  ackEventId: string;
  ackResult: AckResult;
  ackReason: string | null;
}

export type AnyEvent = ApplyEvent | AckEvent;
