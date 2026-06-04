import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { createPropagator, type PropagationRedisClient } from "@naskot/node-hmac-auth-core-propagation";
import { HmacAuthService } from "../hmac-auth/hmac-auth.service.js";

@Injectable()
export class HmacPropagatorService implements OnApplicationBootstrap, OnModuleDestroy {
  private propagator!: Awaited<ReturnType<typeof createPropagator>>;

  constructor(@Inject(HmacAuthService) private readonly hmacAuth: HmacAuthService) {}

  // Receive-only mode: no `management` adapter. The lib consumes inbound events
  // and applies them locally via `hmacAuth.clients.setSecretHash` / `.delete`.
  async onApplicationBootstrap() {
    this.propagator = await createPropagator({
      amqpHost: process.env.AMQP_HOST!,
      amqpPort: Number(process.env.AMQP_PORT ?? 5672),
      amqpUser: process.env.AMQP_USER!,
      amqpPassword: process.env.AMQP_PASSWORD!,
      amqpProtocol: (process.env.AMQP_PROTOCOL as "amqp" | "amqps") ?? "amqp",
      amqpQueue: process.env.AMQP_QUEUE!,
      propagationSecret: process.env.PROPAGATION_SECRET!,
      redis: this.hmacAuth.redis as unknown as PropagationRedisClient,
      hmacHttpAuth: this.hmacAuth.http,
      hmacMessageAuth: this.hmacAuth.message,
      logger: { info: console.info, warn: console.warn, error: console.error },
    });
    console.info(`[c-nest] propagator ready as ${process.env.AMQP_QUEUE} (receive-only)`);
  }

  async onModuleDestroy() {
    await this.propagator?.close();
  }
}
