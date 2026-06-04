import { randomUUID } from "node:crypto";
import { hashClientSecret } from "@naskot/node-hmac-auth-core";
import { recordPublishedEvent } from "./ack-store.js";
import type { Transport } from "./transport.js";
import type {
  ApplyEvent,
  Logger,
  PropagationOp,
  PropagationTrack,
  PropagatorManagement,
  PropagatorOptions,
  SyncSummary,
} from "./types.js";
import { buildQueueName, encodeApplyEvent } from "./wire.js";

export interface SyncContext {
  options: PropagatorOptions;
  management: PropagatorManagement;
  transport: Transport;
  logger: Logger;
}

// One pass over pending propagations: enrich plain with a UUID, hash, apply locally,
// publish one event per target with the target's own propagationSecret.
export async function runSync(ctx: SyncContext): Promise<SyncSummary> {
  const startedAt = Date.now();
  const pending = await ctx.management.fetchPendingPropagations();
  let targetsPublished = 0;
  let targetsRetrying = 0;

  for (const propagation of pending) {
    const { secretHash } = await applyLocal({
      ctx,
      clientId: propagation.clientId,
      track: propagation.track,
      op: propagation.op,
      plain: propagation.secretPlain,
      allowedIps: propagation.allowedIps,
      expiresAt: propagation.expiresAt ?? null,
    });

    for (const target of propagation.pendingTargets) {
      const eventId = randomUUID();
      const sentAt = Date.now();
      const event: ApplyEvent = {
        eventId,
        ts: sentAt,
        propagationSecret: target.propagationSecret,
        senderAmqpQueue: ctx.options.amqpQueue,
        op: propagation.op,
        track: propagation.track,
        clientId: propagation.clientId,
        payload: {
          secretHash,
          allowedIps: propagation.allowedIps,
          expiresAt: propagation.expiresAt ?? null,
        },
      };

      try {
        await ctx.transport.ensureQueueDeclared(buildQueueName(target.targetAmqpQueue));
        await ctx.transport.publishToQueue(buildQueueName(target.targetAmqpQueue), encodeApplyEvent(event));
        await recordPublishedEvent(ctx.options.redis, eventId, {
          clientId: propagation.clientId,
          targetAmqpQueue: target.targetAmqpQueue,
          attemptCount: 1,
          sentAt,
        });
        await ctx.management.markTargetSent({
          clientId: propagation.clientId,
          targetAmqpQueue: target.targetAmqpQueue,
          sentAt,
          attemptCount: 1,
        });
        targetsPublished += 1;
      } catch (err) {
        ctx.logger.warn(
          `[propagation] publish to ${target.targetAmqpQueue} for ${propagation.clientId} failed: ${(err as Error).message}`
        );
        targetsRetrying += 1;
      }
    }
  }

  return {
    propagationsRead: pending.length,
    targetsPublished,
    targetsRetrying,
    durationMs: Date.now() - startedAt,
  };
}

// Apply the propagation locally on this peer before publishing it. The lib enriches the
// plain with a random UUID so the same plain never produces the same hash twice across
// rotations, even if the operator reuses it by mistake.
async function applyLocal(input: {
  ctx: SyncContext;
  clientId: string;
  track: PropagationTrack;
  op: PropagationOp;
  plain: string | null;
  allowedIps: string[] | undefined;
  expiresAt: number | null;
}) {
  const { ctx, clientId, track, op, plain, allowedIps, expiresAt } = input;
  const auth = track === "http" ? ctx.options.hmacHttpAuth : ctx.options.hmacMessageAuth;
  if (!auth) {
    throw new Error(`No ${track} auth instance configured for propagation of ${clientId}`);
  }

  if (op === "credential.delete") {
    await auth.clients.delete(clientId);
    return { secretHash: "" };
  }

  if (plain === null) {
    throw new Error(`Plain is null for non-delete op ${op} on ${clientId}`);
  }

  // Hash the plain using the shared mesh pepper exposed by the core auth instance.
  // Every peer initialized the core lib with the same secretToken, so the hash that
  // we store locally and ship on the wire matches what the target will recompute.
  const secretHash = hashClientSecret(plain, auth.secretToken);
  await auth.clients.setSecretHash(clientId, secretHash, expiresAt ?? undefined, allowedIps);
  return { secretHash };
}

// randomUUID is imported but used only by the publish loop in runSync above.
void randomUUID;
