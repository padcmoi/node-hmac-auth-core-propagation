import { randomUUID } from "node:crypto";
import type { ConsumeMessage } from "amqplib";
import {
  aggregateFinalStatus,
  clearClientAggregates,
  pendingCountForClient,
  readClientResults,
  readPublishedEvent,
  recordTargetResult,
} from "./ack-store.js";
import { isStrictlyNewer, readCursor, writeCursor } from "./cursor.js";
import type { Transport } from "./transport.js";
import type { AckEvent, AnyEvent, ApplyEvent, Logger, PropagatorManagement, PropagatorOptions } from "./types.js";
import { buildQueueName, decodeEvent, encodeAckEvent, isAckEvent, isApplyEvent, propagationSecretMatches } from "./wire.js";

export interface ConsumeContext {
  options: PropagatorOptions;
  management: PropagatorManagement | undefined;
  transport: Transport;
  logger: Logger;
}

// Build the consume handler that the transport will invoke per inbound message.
export function buildConsumeHandler(ctx: ConsumeContext) {
  return async function onMessage(msg: ConsumeMessage) {
    let event: AnyEvent;
    try {
      event = decodeEvent(msg.content);
    } catch (err) {
      ctx.logger.warn(`[propagation] dropping malformed event: ${(err as Error).message}`);
      ctx.transport.ackMessage(msg);
      return;
    }

    if (!propagationSecretMatches(event.propagationSecret, ctx.options.propagationSecret)) {
      ctx.logger.warn(
        `[propagation] propagation-secret-mismatch from ${event.senderAmqpQueue}, dropping eventId=${event.eventId}`
      );
      ctx.transport.ackMessage(msg);
      return;
    }

    if (isAckEvent(event)) {
      await handleAckEvent(ctx, event);
      ctx.transport.ackMessage(msg);
      return;
    }

    if (isApplyEvent(event)) {
      try {
        await handleApplyEvent(ctx, event);
        ctx.transport.ackMessage(msg);
      } catch (err) {
        ctx.logger.error(`[propagation] apply failed for ${event.clientId}, requeue`, err);
        ctx.transport.nackMessage(msg, true);
      }
      return;
    }

    ctx.logger.warn(`[propagation] unknown event op="${(event as AnyEvent).op}", dropping`);
    ctx.transport.ackMessage(msg);
  };
}

async function handleApplyEvent(ctx: ConsumeContext, event: ApplyEvent) {
  // Monotonic cursor: drop replays.
  const current = await readCursor(ctx.options.redis, event.track, event.clientId);
  if (!isStrictlyNewer(current, { ts: event.ts, eventId: event.eventId })) {
    ctx.logger.warn(`[propagation] dropping stale event ${event.eventId} for ${event.clientId}`);
    await publishAckBack(ctx, event, "applied", null);
    return;
  }

  const auth = event.track === "http" ? ctx.options.hmacHttpAuth : ctx.options.hmacMessageAuth;
  if (!auth) {
    const reason = `no ${event.track} auth instance configured`;
    await publishAckBack(ctx, event, "error", reason);
    return;
  }

  // Strict obedience to RabbitMQ. Even in receive-only mode, apply unconditionally.
  if (event.op === "credential.delete") {
    await auth.clients.delete(event.clientId);
  } else {
    await auth.clients.setSecretHash(
      event.clientId,
      event.payload.secretHash,
      event.payload.expiresAt ?? undefined,
      event.payload.allowedIps
    );
  }

  await writeCursor(ctx.options.redis, event.track, event.clientId, { ts: event.ts, eventId: event.eventId });

  await publishAckBack(ctx, event, "applied", null);
}

async function publishAckBack(ctx: ConsumeContext, event: ApplyEvent, result: "applied" | "error", reason: string | null) {
  let propagationSecret = "";
  if (ctx.management) {
    try {
      const fetched = await ctx.management.fetchSourcePropagationSecret(event.senderAmqpQueue);
      if (fetched) propagationSecret = fetched;
    } catch (err) {
      ctx.logger.warn(
        `[propagation] fetchSourcePropagationSecret failed for ${event.senderAmqpQueue}: ${(err as Error).message}`
      );
    }
  }

  if (propagationSecret === "") {
    ctx.logger.warn(
      `[propagation] ack to ${event.senderAmqpQueue} for ${event.clientId} has no source secret; receiver will warn-drop`
    );
  }

  const ackEvent: AckEvent = {
    eventId: randomUUID(),
    ts: Date.now(),
    propagationSecret,
    senderAmqpQueue: ctx.options.amqpQueue,
    op: "credential.ack",
    ackEventId: event.eventId,
    ackResult: result,
    ackReason: reason,
  };

  // The source has already declared its own queue when it booted, so we publish
  // directly without an extra assertQueue (which would serialize on confirmCh
  // and risk stalling concurrent inbound deliveries).
  await ctx.transport.publishToQueue(buildQueueName(event.senderAmqpQueue), encodeAckEvent(ackEvent));
}

async function handleAckEvent(ctx: ConsumeContext, ack: AckEvent) {
  const ackedRecord = await readPublishedEvent(ctx.options.redis, ack.ackEventId);
  if (!ackedRecord) {
    ctx.logger.warn(`[propagation] received ack for unknown eventId=${ack.ackEventId}, dropping`);
    return;
  }

  const at = Date.now();
  const isSuccess = ack.ackResult === "applied";
  await recordTargetResult(
    ctx.options.redis,
    ackedRecord.clientId,
    ackedRecord.targetAmqpQueue,
    isSuccess ? "success" : "error",
    ack.ackEventId
  );

  if (ctx.management) {
    try {
      if (isSuccess) {
        await ctx.management.markTargetSuccess({
          clientId: ackedRecord.clientId,
          targetAmqpQueue: ackedRecord.targetAmqpQueue,
          appliedAt: at,
        });
      } else {
        await ctx.management.markTargetError({
          clientId: ackedRecord.clientId,
          targetAmqpQueue: ackedRecord.targetAmqpQueue,
          reason: ack.ackReason ?? "unknown",
          failedAt: at,
        });
      }

      const remaining = await pendingCountForClient(ctx.options.redis, ackedRecord.clientId);
      if (remaining === 0) {
        const results = await readClientResults(ctx.options.redis, ackedRecord.clientId);
        const finalStatus = aggregateFinalStatus(results);
        await ctx.management.markCredentialFullyPropagated({
          clientId: ackedRecord.clientId,
          finalStatus,
          at,
        });
        await clearClientAggregates(ctx.options.redis, ackedRecord.clientId);
      }
    } catch (err) {
      ctx.logger.error(`[propagation] management callback failed during ack handling for ${ackedRecord.clientId}`, err);
    }
  }
}
