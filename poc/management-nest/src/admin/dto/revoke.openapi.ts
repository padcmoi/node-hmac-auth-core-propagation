import { ApiProperty } from "@nestjs/swagger";
import { RevokeDto, RevokeResponseDto } from "./revoke.dto.js";

ApiProperty({ type: String, description: "ClientId to revoke across the mesh.", example: "client_partner_a", maxLength: 128 })(
  RevokeDto.prototype,
  "clientId"
);

ApiProperty({
  type: [String],
  description: "Targets to propagate the deletion to.",
  example: ["c-nest", "nuxt", "next"],
})(RevokeDto.prototype, "targets");

ApiProperty({ type: String, example: "client_partner_a" })(RevokeResponseDto.prototype, "clientId");
