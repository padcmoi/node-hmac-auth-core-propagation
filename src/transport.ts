import amqplib from "amqplib";
import type { Channel, ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";
import type { Logger, PropagatorOptions } from "./types.js";
import { DEFAULT_AMQP_VHOST, buildQueueName } from "./wire.js";

// Thin wrapper around amqplib that gives us:
//   - a durable queue declared at boot,
//   - a confirm channel for publishing with broker confirmations,
//   - a plain channel for consuming with prefetch=1,
//   - reconnection on close/error,
//   - graceful shutdown.

export interface Transport {
  publishToQueue: (queueName: string, payload: Buffer) => Promise<void>;
  ensureQueueDeclared: (queueName: string) => Promise<void>;
  ackMessage: (msg: ConsumeMessage) => void;
  nackMessage: (msg: ConsumeMessage, requeue: boolean) => void;
  startConsume: () => Promise<void>;
  ownQueueName: string;
  close: () => Promise<void>;
}

export interface ConsumeHandler {
  (msg: ConsumeMessage): Promise<void>;
}

export interface CreateTransportInput {
  options: Pick<
    PropagatorOptions,
    "amqpHost" | "amqpPort" | "amqpUser" | "amqpPassword" | "amqpProtocol" | "amqpVhost" | "amqpQueue"
  >;
  logger: Logger;
  onMessage: ConsumeHandler;
}

export async function createTransport(input: CreateTransportInput): Promise<Transport> {
  const { options, logger, onMessage } = input;
  const ownQueueName = buildQueueName(options.amqpQueue);
  const vhost = options.amqpVhost ?? DEFAULT_AMQP_VHOST;

  let connection: ChannelModel | null = null;
  let confirmCh: ConfirmChannel | null = null;
  let consumeCh: Channel | null = null;
  let stopped = false;
  let consumeRequested = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 1000;

  async function registerConsume() {
    if (!consumeCh) return;
    await consumeCh.consume(ownQueueName, (msg) => {
      if (msg === null) return;
      void runHandler(msg);
    });
  }

  // Queues we have already declared on the current channel. Default exchange
  // silently drops messages whose routing key matches no queue, so the producer
  // must assertQueue on every target before publishing or offline peers lose
  // their messages forever. We cache declarations per channel lifecycle.
  let declaredQueues = new Set<string>();

  async function connect() {
    if (stopped) return;
    try {
      connection = await amqplib.connect({
        protocol: options.amqpProtocol,
        hostname: options.amqpHost,
        port: options.amqpPort,
        username: options.amqpUser,
        password: options.amqpPassword,
        vhost,
        // 10s heartbeat (default would be 60s) so RabbitMQ evicts dead consumers fast.
        // A peer that died with unacked messages: broker requeues them within 2x10s=20s,
        // the next peer-on-restart picks them up immediately instead of waiting ~120s.
        heartbeat: 10,
      });
      connection.on("error", (err) => logger.warn("[propagation] amqp connection error", err));
      connection.on("close", () => {
        if (stopped) return;
        logger.warn("[propagation] amqp connection closed, scheduling reconnect");
        scheduleReconnect();
      });

      confirmCh = await connection.createConfirmChannel();
      consumeCh = await connection.createChannel();
      await consumeCh.prefetch(1);
      declaredQueues = new Set<string>();
      await consumeCh.assertQueue(ownQueueName, { durable: true });
      declaredQueues.add(ownQueueName);

      // CRITICAL: we register basic.consume only AFTER the caller signals "handler is ready"
      // (transport.startConsume). Otherwise a redelivered message can race between the
      // placeholder no-op handler and the real one, leaving it Unacked on the channel and
      // freezing the consumer because of prefetch=1.
      if (consumeRequested) await registerConsume();

      backoffMs = 1000;
      logger.info(`[propagation] amqp connected, queue=${ownQueueName} vhost=${vhost}`);
    } catch (err) {
      logger.warn(`[propagation] amqp connect failed: ${(err as Error).message}`);
      scheduleReconnect();
    }
  }

  async function runHandler(msg: ConsumeMessage) {
    try {
      await onMessage(msg);
    } catch (err) {
      logger.error("[propagation] consume handler threw", err);
      // requeue=true so the message comes back after the broker's redelivery delay.
      consumeCh?.nack(msg, false, true);
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    if (reconnectTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, 60_000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  // The producer declares its target queues on its own channel so the default
  // exchange has a binding when we publish. Declarations are cached and
  // performed BEFORE the publish to avoid interleaving assertQueue with the
  // publish-with-confirm callback on the same channel.
  async function ensureQueueDeclared(queueName: string) {
    if (!confirmCh) throw new Error("amqp not connected");
    if (declaredQueues.has(queueName)) return;
    await confirmCh.assertQueue(queueName, { durable: true });
    declaredQueues.add(queueName);
  }

  async function publishToQueue(queueName: string, payload: Buffer) {
    if (!confirmCh) throw new Error("amqp not connected");
    const ch = confirmCh;
    await new Promise<void>((resolve, reject) => {
      const ok = ch.publish("", queueName, payload, { persistent: true, contentType: "application/json" }, (err) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      });
      if (!ok) {
        // Channel buffer is full. The drain event would let us resume but we just wait for
        // the confirm callback which always fires once the broker confirms the publish.
      }
    });
  }

  function ackMessage(msg: ConsumeMessage) {
    consumeCh?.ack(msg);
  }

  function nackMessage(msg: ConsumeMessage, requeue: boolean) {
    consumeCh?.nack(msg, false, requeue);
  }

  async function close() {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      await consumeCh?.close();
    } catch {
      /* ignore */
    }
    try {
      await confirmCh?.close();
    } catch {
      /* ignore */
    }
    try {
      await connection?.close();
    } catch {
      /* ignore */
    }
    consumeCh = null;
    confirmCh = null;
    connection = null;
  }

  await connect();

  // Explicit start so the caller can finish wiring its real consume handler
  // before basic.consume registers. Idempotent and reconnect-safe (the flag is
  // checked again inside connect() after each reconnect).
  async function startConsume() {
    consumeRequested = true;
    await registerConsume();
  }

  return { publishToQueue, ensureQueueDeclared, ackMessage, nackMessage, startConsume, ownQueueName, close };
}
