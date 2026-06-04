import { ApiProperty } from "@nestjs/swagger";
import { CallTargetDto, CallTargetResponseDto } from "./call-target.dto.js";

ApiProperty({
  type: String,
  description: "Absolute URL of the peer's HMAC-signed route.",
  example: "http://consumer-nest:3002/api/echo",
})(CallTargetDto.prototype, "target");

ApiProperty({ type: String, description: "ClientId to sign with.", example: "client_partner_a" })(
  CallTargetDto.prototype,
  "clientId"
);

ApiProperty({
  type: String,
  description: "Plain secret. The client pre-hashes with HMAC_SECRET_TOKEN so the signature matches the peer's stored hash.",
  example: "plain-text-secret",
})(CallTargetDto.prototype, "secret");

ApiProperty({ type: Number, description: "HTTP status code returned by the peer.", example: 200 })(
  CallTargetResponseDto.prototype,
  "status"
);
ApiProperty({
  type: String,
  description: "Raw response body returned by the peer.",
  example: '{"ok":true,"clientId":"client_partner_a"}',
})(CallTargetResponseDto.prototype, "body");
