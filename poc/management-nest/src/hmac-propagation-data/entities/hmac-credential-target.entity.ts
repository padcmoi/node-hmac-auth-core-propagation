import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { HmacCredential } from "./hmac-credential.entity.js";
import { HmacPropagationTarget } from "./hmac-propagation-target.entity.js";

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
