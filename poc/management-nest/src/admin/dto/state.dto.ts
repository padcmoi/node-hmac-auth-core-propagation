export class HmacCredentialDto {
  clientId!: string;
  track!: "http" | "message";
  secretPlain!: string | null;
  allowedIps!: string[] | null;
  expiresAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class HmacPropagationTargetDto {
  targetAmqpQueue!: string;
  propagationSecret!: string;
  note!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class HmacCredentialTargetDto {
  clientId!: string;
  targetAmqpQueue!: string;
  status!: "pending" | "sent" | "success" | "error";
  attemptCount!: number;
  reason!: string | null;
  sentAt!: Date | null;
  appliedAt!: Date | null;
  failedAt!: Date | null;
  updatedAt!: Date;
}

export class StateResponseDto {
  credentials!: HmacCredentialDto[];
  targets!: HmacPropagationTargetDto[];
  pivots!: HmacCredentialTargetDto[];
}
