import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { HmacCredentialTarget } from "./hmac-credential-target.entity.js";

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
