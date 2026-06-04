import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { createPropagator, type PendingPropagation, type PropagationRedisClient } from "@naskot/node-hmac-auth-core-propagation";
import { HmacAuthService } from "../hmac-auth/hmac-auth.service.js";
import { HmacCredential, HmacCredentialTarget, HmacPropagationTarget } from "../hmac-propagation-data/entities/index.js";

@Injectable()
export class HmacPropagatorService implements OnApplicationBootstrap, OnModuleDestroy {
  private propagator!: Awaited<ReturnType<typeof createPropagator>>;

  constructor(
    @Inject(HmacAuthService) private readonly hmacAuth: HmacAuthService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(HmacCredential) private readonly credentials: Repository<HmacCredential>,
    @InjectRepository(HmacPropagationTarget) private readonly targetsDir: Repository<HmacPropagationTarget>,
    @InjectRepository(HmacCredentialTarget) private readonly ct: Repository<HmacCredentialTarget>
  ) {}

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
              { status: "pending", attemptCount: 0, reason: null, sentAt: null, appliedAt: null, failedAt: null }
            );
          });
        },

        fetchPendingPropagations: async () => {
          // Publish-once policy: the broker holds the message in a durable queue with publisher
          // confirms, so a single publish is enough. We only republish rows still in `pending`
          // (publish never reached the broker). Rows in `sent` wait for the target's ACK back
          // event, which flips them to `success`. A target offline for a week sees ONE message
          // per (clientId, target) sitting in its queue, not thousands.
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

    console.info(`[mgmt-nest] propagator ready as ${process.env.AMQP_QUEUE}`);
  }

  async onModuleDestroy() {
    await this.propagator?.close();
  }

  ensure(input: Parameters<NonNullable<typeof this.propagator.ensure>>[0]) {
    return this.propagator.ensure(input);
  }
  rotate(input: Parameters<NonNullable<typeof this.propagator.rotate>>[0]) {
    return this.propagator.rotate(input);
  }
  revoke(input: Parameters<NonNullable<typeof this.propagator.revoke>>[0]) {
    return this.propagator.revoke(input);
  }
  sync() {
    return this.propagator.sync();
  }
}
