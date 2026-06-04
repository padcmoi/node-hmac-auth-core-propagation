# TypeORM entities + NestJS module

**Docs:** [README](../README.md) · [Architecture](./architecture.md) · [Wire contract](./wire-contract.md) · [SQL schema](./sql-schema.md) · TypeORM entities · [Express](./express/README.md) · [NestJS](./nestjs/README.md) · [Nuxt](./nuxt/README.md) · [Next.js](./nextjs/README.md) · [Release notes 1.0.0](./release-notes/1.0.0.md) · [CHANGELOG](../CHANGELOG.md) · [POC](../poc/README.md)

---

A drop-in container module that registers the 4 entities and re-exports
`TypeOrmModule.forFeature(...)` so any caller can inject the repositories. The
business logic lives in the propagator service that wraps `createPropagator`.

## Layout

```
src/
  hmac-propagation-data/
    hmac-propagation-data.module.ts
    entities/
      index.ts
      hmac-credential.entity.ts
      hmac-propagation-target.entity.ts
      hmac-credential-target.entity.ts
      hmac-credential-target-audit.entity.ts
```

## Entity Table 1: HmacCredential

```ts
// src/hmac-propagation-data/entities/hmac-credential.entity.ts
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { HmacCredentialTarget } from "./hmac-credential-target.entity";

@Entity({ name: "hmac_credential" })
export class HmacCredential {
  @PrimaryColumn({ type: "varchar", length: 128, name: "client_id" })
  clientId!: string;

  @Column({ type: "enum", enum: ["http", "message"] })
  track!: "http" | "message";

  @Column({ type: "text", name: "secret_plain", nullable: true })
  secretPlain!: string | null;

  @Column({ type: "json", name: "allowed_ips", nullable: true })
  allowedIps!: string[] | null;

  @Column({ type: "datetime", precision: 3, name: "expires_at", nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: "created_at", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", precision: 3 })
  updatedAt!: Date;

  @OneToMany(() => HmacCredentialTarget, (ct) => ct.credential)
  targets!: HmacCredentialTarget[];
}
```

## Entity Table 2: HmacPropagationTarget

```ts
// src/hmac-propagation-data/entities/hmac-propagation-target.entity.ts
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { HmacCredentialTarget } from "./hmac-credential-target.entity";

@Entity({ name: "hmac_propagation_target" })
export class HmacPropagationTarget {
  @PrimaryColumn({ type: "varchar", length: 128, name: "target_amqp_queue" })
  targetAmqpQueue!: string;

  @Column({ type: "text", name: "propagation_secret" })
  propagationSecret!: string;

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: "created_at", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", precision: 3 })
  updatedAt!: Date;

  @OneToMany(() => HmacCredentialTarget, (ct) => ct.target)
  credentialTargets!: HmacCredentialTarget[];
}
```

## Entity Table 3: HmacCredentialTarget (pivot)

```ts
// src/hmac-propagation-data/entities/hmac-credential-target.entity.ts
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { HmacCredential } from "./hmac-credential.entity";
import { HmacPropagationTarget } from "./hmac-propagation-target.entity";

@Entity({ name: "hmac_credential_target" })
@Index("idx_status", ["status"])
export class HmacCredentialTarget {
  @PrimaryColumn({ type: "varchar", length: 128, name: "client_id" })
  clientId!: string;

  @PrimaryColumn({ type: "varchar", length: 128, name: "target_amqp_queue" })
  targetAmqpQueue!: string;

  @Column({ type: "enum", enum: ["pending", "sent", "success", "error"], default: "pending" })
  status!: "pending" | "sent" | "success" | "error";

  @Column({ type: "int", unsigned: true, name: "attempt_count", default: 0 })
  attemptCount!: number;

  @Column({ type: "text", nullable: true })
  reason!: string | null;

  @Column({ type: "datetime", precision: 3, name: "sent_at", nullable: true })
  sentAt!: Date | null;

  @Column({ type: "datetime", precision: 3, name: "applied_at", nullable: true })
  appliedAt!: Date | null;

  @Column({ type: "datetime", precision: 3, name: "failed_at", nullable: true })
  failedAt!: Date | null;

  @UpdateDateColumn({ name: "updated_at", precision: 3 })
  updatedAt!: Date;

  @ManyToOne(() => HmacCredential, (c) => c.targets, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "client_id" })
  credential!: HmacCredential;

  @ManyToOne(() => HmacPropagationTarget, (t) => t.credentialTargets, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "target_amqp_queue" })
  target!: HmacPropagationTarget;
}
```

## Entity Table 4: HmacCredentialTargetAudit

```ts
// src/hmac-propagation-data/entities/hmac-credential-target-audit.entity.ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "hmac_credential_target_audit" })
@Index("idx_client", ["clientId"])
@Index("idx_at", ["at"])
export class HmacCredentialTargetAudit {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ type: "varchar", length: 128, name: "client_id" })
  clientId!: string;

  @Column({ type: "varchar", length: 128, name: "target_amqp_queue" })
  targetAmqpQueue!: string;

  @Column({
    type: "enum",
    enum: ["ensure", "rotate", "revoke", "target_sent", "target_success", "target_error", "fully_propagated"],
    name: "event_type",
  })
  eventType!: "ensure" | "rotate" | "revoke" | "target_sent" | "target_success" | "target_error" | "fully_propagated";

  @Column({ type: "varchar", length: 32, nullable: true })
  status!: string | null;

  @Column({ type: "text", nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: "at", precision: 3 })
  at!: Date;
}
```

## Barrel and module

```ts
// src/hmac-propagation-data/entities/index.ts
export { HmacCredential } from "./hmac-credential.entity";
export { HmacPropagationTarget } from "./hmac-propagation-target.entity";
export { HmacCredentialTarget } from "./hmac-credential-target.entity";
export { HmacCredentialTargetAudit } from "./hmac-credential-target-audit.entity";
```

```ts
// src/hmac-propagation-data/hmac-propagation-data.module.ts
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HmacCredential, HmacCredentialTarget, HmacCredentialTargetAudit, HmacPropagationTarget } from "./entities";

@Module({
  imports: [TypeOrmModule.forFeature([HmacCredential, HmacPropagationTarget, HmacCredentialTarget, HmacCredentialTargetAudit])],
  exports: [TypeOrmModule],
})
export class HmacPropagationDataModule {}
```

That is the full data container. The propagator service that wraps
`createPropagator` is in [nestjs/README.md](./nestjs/README.md).
