import { ApiProperty } from "@nestjs/swagger";
import { EnsureDto, EnsureResponseDto } from "./ensure.dto.js";

ApiProperty({
  type: String,
  description: "Logical client identifier known to every peer of the mesh.",
  example: "client_partner_a",
  maxLength: 128,
})(EnsureDto.prototype, "clientId");

ApiProperty({
  type: String,
  description: "Plain secret to provision. Hashed with HMAC_SECRET_TOKEN before publish, never sent on the wire as plain.",
  example: "plain-text-secret",
})(EnsureDto.prototype, "secret");

ApiProperty({
  type: [String],
  description: "Target amqpQueues to propagate to. Each must exist in `hmac_propagation_target` (Table 2).",
  example: ["c-nest", "nuxt", "next"],
})(EnsureDto.prototype, "targets");

ApiProperty({ type: String, example: "client_partner_a" })(EnsureResponseDto.prototype, "clientId");
ApiProperty({ type: String, enum: ["credential.create", "credential.update"], example: "credential.create" })(
  EnsureResponseDto.prototype,
  "op"
);
