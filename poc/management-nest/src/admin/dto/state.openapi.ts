import { ApiProperty } from "@nestjs/swagger";
import { HmacCredentialDto, HmacCredentialTargetDto, HmacPropagationTargetDto, StateResponseDto } from "./state.dto.js";

// Table 1 — hmac_credential
ApiProperty({ type: String, example: "client_partner_a" })(HmacCredentialDto.prototype, "clientId");
ApiProperty({ type: String, enum: ["http", "message"], example: "http" })(HmacCredentialDto.prototype, "track");
ApiProperty({ type: String, nullable: true, example: null, description: "Null once fully propagated." })(
  HmacCredentialDto.prototype,
  "secretPlain"
);
ApiProperty({ type: [String], nullable: true, example: ["10.0.0.0/8"] })(HmacCredentialDto.prototype, "allowedIps");
ApiProperty({ type: String, format: "date-time", nullable: true })(HmacCredentialDto.prototype, "expiresAt");
ApiProperty({ type: String, format: "date-time" })(HmacCredentialDto.prototype, "createdAt");
ApiProperty({ type: String, format: "date-time" })(HmacCredentialDto.prototype, "updatedAt");

// Table 2 — hmac_propagation_target
ApiProperty({ type: String, example: "c-nest" })(HmacPropagationTargetDto.prototype, "targetAmqpQueue");
ApiProperty({ type: String, description: "Env propagationSecret of the target peer." })(
  HmacPropagationTargetDto.prototype,
  "propagationSecret"
);
ApiProperty({ type: String, nullable: true })(HmacPropagationTargetDto.prototype, "note");
ApiProperty({ type: String, format: "date-time" })(HmacPropagationTargetDto.prototype, "createdAt");
ApiProperty({ type: String, format: "date-time" })(HmacPropagationTargetDto.prototype, "updatedAt");

// Table 3 — hmac_credential_target
ApiProperty({ type: String, example: "client_partner_a" })(HmacCredentialTargetDto.prototype, "clientId");
ApiProperty({ type: String, example: "c-nest" })(HmacCredentialTargetDto.prototype, "targetAmqpQueue");
ApiProperty({ type: String, enum: ["pending", "sent", "success", "error"], example: "success" })(
  HmacCredentialTargetDto.prototype,
  "status"
);
ApiProperty({ type: Number, example: 1 })(HmacCredentialTargetDto.prototype, "attemptCount");
ApiProperty({ type: String, nullable: true })(HmacCredentialTargetDto.prototype, "reason");
ApiProperty({ type: String, format: "date-time", nullable: true })(HmacCredentialTargetDto.prototype, "sentAt");
ApiProperty({ type: String, format: "date-time", nullable: true })(HmacCredentialTargetDto.prototype, "appliedAt");
ApiProperty({ type: String, format: "date-time", nullable: true })(HmacCredentialTargetDto.prototype, "failedAt");
ApiProperty({ type: String, format: "date-time" })(HmacCredentialTargetDto.prototype, "updatedAt");

// Aggregate
ApiProperty({ type: [HmacCredentialDto] })(StateResponseDto.prototype, "credentials");
ApiProperty({ type: [HmacPropagationTargetDto] })(StateResponseDto.prototype, "targets");
ApiProperty({ type: [HmacCredentialTargetDto] })(StateResponseDto.prototype, "pivots");
