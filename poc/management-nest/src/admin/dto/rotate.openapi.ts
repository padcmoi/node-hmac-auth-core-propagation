import { ApiProperty } from "@nestjs/swagger";
import { RotateDto, RotateResponseDto } from "./rotate.dto.js";

ApiProperty({
  type: String,
  description: "ClientId to rotate. Must already exist in the local credential store.",
  example: "client_partner_a",
  maxLength: 128,
})(RotateDto.prototype, "clientId");

ApiProperty({
  type: String,
  description: "New plain secret. The lib re-marks every existing target as pending and resyncs.",
  example: "new-plain-secret",
})(RotateDto.prototype, "secret");

ApiProperty({ type: String, example: "client_partner_a" })(RotateResponseDto.prototype, "clientId");
