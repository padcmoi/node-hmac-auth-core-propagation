import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { HmacCredentialTarget } from "./hmac-credential-target.entity.js";

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
