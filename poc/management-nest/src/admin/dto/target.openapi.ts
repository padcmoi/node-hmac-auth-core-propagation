import { ApiProperty } from "@nestjs/swagger";
import { CreateTargetDto, TargetMutationResponseDto } from "./target.dto.js";

ApiProperty({
  type: String,
  description: "AMQP queue name of the target peer. Must match the peer's `AMQP_QUEUE` env.",
  example: "partner-x",
  maxLength: 128,
})(CreateTargetDto.prototype, "targetAmqpQueue");

ApiProperty({
  type: String,
  description:
    "Shared secret used to HMAC-sign events sent to this target. The receiving peer rejects events whose signature does not match its own `PROPAGATION_SECRET`.",
  example: "secret-of-partner-x",
})(CreateTargetDto.prototype, "propagationSecret");

ApiProperty({
  type: String,
  required: false,
  description: "Free-text label, surfaced in `GET /admin/state` for operators.",
  example: "External partner peer",
})(CreateTargetDto.prototype, "note");

ApiProperty({
  type: String,
  enum: ["target.create", "target.update", "target.delete"],
  example: "target.create",
})(TargetMutationResponseDto.prototype, "op");

ApiProperty({ type: String, example: "partner-x" })(TargetMutationResponseDto.prototype, "targetAmqpQueue");
