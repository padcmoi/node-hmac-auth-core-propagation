# NestJS integration

**Docs:** [README](../../README.md) · [Architecture](../architecture.md) · [Wire contract](../wire-contract.md) · [SQL schema](../sql-schema.md) · [TypeORM entities](../entities-nestjs.md) · [Express](../express/README.md) · NestJS · [Nuxt](../nuxt/README.md) · [Next.js](../nextjs/README.md) · [Release notes 1.0.0](../release-notes/1.0.0.md) · [CHANGELOG](../../CHANGELOG.md) · [POC](../../poc/README.md)

---

The lib is framework-agnostic. The pattern below is the canonical NestJS wiring
used by the POC: an `HmacPropagatorModule` whose service instantiates
`createPropagator` in `onModuleInit`, closes it in `onModuleDestroy`, and proxies
the helpers `ensure / rotate / revoke / sync`.

## Module + service

```ts
// src/hmac-propagator/hmac-propagator.module.ts
import { Module } from "@nestjs/common";
import { HmacPropagationDataModule } from "../hmac-propagation-data/hmac-propagation-data.module";
import { HmacAuthModule } from "../hmac-auth/hmac-auth.module";
import { HmacPropagatorService } from "./hmac-propagator.service";

@Module({
  imports: [HmacPropagationDataModule, HmacAuthModule],
  providers: [HmacPropagatorService],
  exports: [HmacPropagatorService],
})
export class HmacPropagatorModule {}
```

```ts
// src/hmac-propagator/hmac-propagator.service.ts
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { createPropagator, type PendingPropagation, type PropagationRedisClient } from "@naskot/node-hmac-auth-core-propagation";
import { HmacCredential, HmacCredentialTarget, HmacPropagationTarget } from "../hmac-propagation-data/entities";
import { HmacAuthService } from "../hmac-auth/hmac-auth.service";

@Injectable()
export class HmacPropagatorService implements OnModuleInit, OnModuleDestroy {
  private propagator!: Awaited<ReturnType<typeof createPropagator>>;

  constructor(
    @InjectRepository(HmacCredential) private readonly credentials: Repository<HmacCredential>,
    @InjectRepository(HmacPropagationTarget) private readonly targetsDir: Repository<HmacPropagationTarget>,
    @InjectRepository(HmacCredentialTarget) private readonly ct: Repository<HmacCredentialTarget>,
    @Inject(DataSource) private readonly dataSource: DataSource,
    private readonly hmacAuth: HmacAuthService
  ) {}

  async onModuleInit() {
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
      management: {
        upsertCredentialWithTargets: async (input) => {
          await this.dataSource.transaction(async (em) => {
            await em.upsert(
              HmacCredential,
              {
                clientId: input.clientId,
                track: input.track,
                secretPlain: input.secretPlain,
                allowedIps: input.allowedIps ?? null,
                expiresAt: input.expiresAt != null ? new Date(input.expiresAt) : null,
              },
              ["clientId"]
            );
            for (const t of input.targets) {
              await em.upsert(
                HmacCredentialTarget,
                {
                  clientId: input.clientId,
                  targetAmqpQueue: t,
                  status: "pending",
                  attemptCount: 0,
                  reason: null,
                  sentAt: null,
                  appliedAt: null,
                  failedAt: null,
                },
                ["clientId", "targetAmqpQueue"]
              );
            }
          });
        },
        rotateCredentialSecret: async (input) => {
          await this.dataSource.transaction(async (em) => {
            await em.update(HmacCredential, { clientId: input.clientId }, { secretPlain: input.secretPlain });
            await em.update(
              HmacCredentialTarget,
              { clientId: input.clientId },
              {
                status: "pending",
                attemptCount: 0,
                reason: null,
                sentAt: null,
                appliedAt: null,
                failedAt: null,
              }
            );
          });
        },
        fetchPendingPropagations: async () => {
          // Publish-once: only return `pending` rows. `sent` rows already live in the
          // durable AMQP queue; republishing them would spam the broker for nothing.
          const rows = await this.credentials
            .createQueryBuilder("c")
            .innerJoinAndSelect("c.targets", "ct", "ct.status = :s", { s: "pending" })
            .innerJoinAndSelect("ct.target", "t")
            .getMany();
          return rows.map((r) => ({
            clientId: r.clientId,
            track: r.track,
            op:
              r.secretPlain == null
                ? "credential.delete"
                : r.createdAt.getTime() === r.updatedAt.getTime()
                  ? "credential.create"
                  : "credential.update",
            secretPlain: r.secretPlain,
            allowedIps: r.allowedIps ?? undefined,
            expiresAt: r.expiresAt?.getTime() ?? null,
            pendingTargets: r.targets.map((row) => ({
              targetAmqpQueue: row.targetAmqpQueue,
              propagationSecret: row.target.propagationSecret,
            })),
          })) satisfies PendingPropagation[];
        },
        fetchSourcePropagationSecret: async (senderAmqpQueue) => {
          const row = await this.targetsDir.findOne({ where: { targetAmqpQueue: senderAmqpQueue } });
          return row?.propagationSecret ?? null;
        },
        markTargetSent: async ({ clientId, targetAmqpQueue, sentAt, attemptCount }) => {
          await this.ct.update({ clientId, targetAmqpQueue }, { status: "sent", sentAt: new Date(sentAt), attemptCount });
        },
        markTargetSuccess: async ({ clientId, targetAmqpQueue, appliedAt }) => {
          await this.ct.update(
            { clientId, targetAmqpQueue },
            { status: "success", appliedAt: new Date(appliedAt), reason: null, failedAt: null }
          );
        },
        markTargetError: async ({ clientId, targetAmqpQueue, reason, failedAt }) => {
          await this.ct.update({ clientId, targetAmqpQueue }, { status: "error", reason, failedAt: new Date(failedAt) });
        },
        markCredentialFullyPropagated: async ({ clientId }) => {
          await this.credentials.update({ clientId }, { secretPlain: null });
        },
      },
      logger: { info: console.info, warn: console.warn, error: console.error },
    });
  }

  async onModuleDestroy() {
    await this.propagator?.close();
  }

  ensure(input: Parameters<typeof this.propagator.ensure>[0]) {
    return this.propagator.ensure(input);
  }
  rotate(input: Parameters<typeof this.propagator.rotate>[0]) {
    return this.propagator.rotate(input);
  }
  revoke(input: Parameters<typeof this.propagator.revoke>[0]) {
    return this.propagator.revoke(input);
  }
  sync() {
    return this.propagator.sync();
  }
}
```

## Cron driver

```ts
// src/hmac-propagator/hmac-propagator.cron.ts
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { HmacPropagatorService } from "./hmac-propagator.service";

@Injectable()
export class HmacPropagatorCron {
  private readonly logger = new Logger(HmacPropagatorCron.name);

  constructor(private readonly propagator: HmacPropagatorService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick() {
    const summary = await this.propagator.sync();
    if (summary.targetsPublished > 0 || summary.targetsRetrying > 0) {
      this.logger.log(`sync: ${JSON.stringify(summary)}`);
    }
  }
}
```

Add `HmacPropagatorCron` to `HmacPropagatorModule.providers` and import
`ScheduleModule.forRoot()` at the `AppModule` level.

## Receive-only consumer

Same module + service, just drop `management` from the options. The cron is also
unnecessary since `sync()` would throw `MANAGEMENT_NOT_CONFIGURED`.
