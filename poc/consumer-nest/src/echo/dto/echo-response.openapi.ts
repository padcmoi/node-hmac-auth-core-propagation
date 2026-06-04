import { ApiProperty } from "@nestjs/swagger";
import { EchoResponseDto } from "./echo-response.dto.js";

ApiProperty({ type: Boolean, description: "Always `true` for a successful HMAC verification.", example: true })(
  EchoResponseDto.prototype,
  "ok"
);
ApiProperty({ type: String, description: "Own `AMQP_QUEUE` of this peer, set via env.", example: "c-nest" })(
  EchoResponseDto.prototype,
  "peer"
);
ApiProperty({
  type: String,
  required: false,
  description: "ClientId resolved by the HMAC verifier from the `x-client-id` header.",
  example: "client_partner_a",
})(EchoResponseDto.prototype, "clientId");
