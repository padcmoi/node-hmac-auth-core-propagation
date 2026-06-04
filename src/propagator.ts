import type { ConsumeMessage } from "amqplib";
import { buildConsumeHandler } from "./consume.js";
import { HmacPropagationError } from "./errors.js";
import { runSync } from "./sync.js";
import { createTransport } from "./transport.js";
import type { EnsureInput, Logger, Propagator, PropagatorOptions, RevokeInput, RotateInputUsage } from "./types.js";

const NOOP_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function assertOptions(options: PropagatorOptions) {
  if (!options.amqpHost) throw new HmacPropagationError("INVALID_OPTIONS", "amqpHost is required");
  if (!options.amqpPort) throw new HmacPropagationError("INVALID_OPTIONS", "amqpPort is required");
  if (!options.amqpUser) throw new HmacPropagationError("INVALID_OPTIONS", "amqpUser is required");
  if (!options.amqpPassword) throw new HmacPropagationError("INVALID_OPTIONS", "amqpPassword is required");
  if (!options.amqpProtocol) throw new HmacPropagationError("INVALID_OPTIONS", "amqpProtocol is required");
  if (!options.amqpQueue) throw new HmacPropagationError("INVALID_OPTIONS", "amqpQueue is required");
  if (!options.propagationSecret) throw new HmacPropagationError("INVALID_OPTIONS", "propagationSecret is required");
  if (!options.redis) throw new HmacPropagationError("INVALID_OPTIONS", "redis is required");
  if (!options.hmacHttpAuth && !options.hmacMessageAuth) {
    throw new HmacPropagationError("INVALID_OPTIONS", "At least one of hmacHttpAuth or hmacMessageAuth must be provided");
  }
}

export async function createPropagator(options: PropagatorOptions): Promise<Propagator> {
  assertOptions(options);
  const logger = options.logger ?? NOOP_LOGGER;

  const consumeHandlerHolder: { handler: (msg: ConsumeMessage) => Promise<void> } = {
    handler: async () => {},
  };

  const transport = await createTransport({
    options: {
      amqpHost: options.amqpHost,
      amqpPort: options.amqpPort,
      amqpUser: options.amqpUser,
      amqpPassword: options.amqpPassword,
      amqpProtocol: options.amqpProtocol,
      amqpVhost: options.amqpVhost,
      amqpQueue: options.amqpQueue,
    },
    logger,
    onMessage: (msg) => consumeHandlerHolder.handler(msg),
  });

  consumeHandlerHolder.handler = buildConsumeHandler({
    options,
    management: options.management,
    transport,
    logger,
  });

  // Now that the real handler is installed, ask the transport to register
  // `basic.consume`. Doing it earlier would race: a redelivered message can
  // hit the no-op placeholder, sit Unacked, and freeze the consumer on
  // prefetch=1.
  await transport.startConsume();

  function requireManagement() {
    if (!options.management) {
      throw new HmacPropagationError(
        "MANAGEMENT_NOT_CONFIGURED",
        "ensure/rotate/revoke/sync require the management adapter to be configured in createPropagator options"
      );
    }
    return options.management;
  }

  async function ensure(input: EnsureInput) {
    const management = requireManagement();
    const track = input.track ?? "http";
    const auth = track === "http" ? options.hmacHttpAuth : options.hmacMessageAuth;
    if (!auth) {
      throw new HmacPropagationError("INVALID_OPTIONS", `No ${track} auth instance configured`);
    }

    const existing = await auth.clients.get(input.clientId);
    const op: "credential.create" | "credential.update" = existing ? "credential.update" : "credential.create";

    await management.upsertCredentialWithTargets({
      clientId: input.clientId,
      track,
      op,
      secretPlain: input.secret,
      allowedIps: input.allowedIps,
      expiresAt: input.expiresAt ?? null,
      targets: input.targets,
    });

    return { clientId: input.clientId, op };
  }

  async function rotate(input: RotateInputUsage) {
    const management = requireManagement();
    const track = input.track ?? "http";
    const auth = track === "http" ? options.hmacHttpAuth : options.hmacMessageAuth;
    if (!auth) {
      throw new HmacPropagationError("INVALID_OPTIONS", `No ${track} auth instance configured`);
    }

    const existing = await auth.clients.get(input.clientId);
    if (!existing) {
      throw new HmacPropagationError("UNKNOWN_CLIENT", `rotate: clientId "${input.clientId}" does not exist`);
    }

    await management.rotateCredentialSecret({
      clientId: input.clientId,
      track,
      secretPlain: input.secret,
    });

    return { clientId: input.clientId };
  }

  async function revoke(input: RevokeInput) {
    const management = requireManagement();
    const track = input.track ?? "http";

    await management.upsertCredentialWithTargets({
      clientId: input.clientId,
      track,
      op: "credential.delete",
      secretPlain: null,
      targets: input.targets,
    });

    return { clientId: input.clientId };
  }

  async function sync() {
    const management = requireManagement();
    return runSync({ options, management, transport, logger });
  }

  async function close() {
    await transport.close();
  }

  return { close, ensure, rotate, revoke, sync };
}
