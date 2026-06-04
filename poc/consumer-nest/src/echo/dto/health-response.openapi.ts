import { ApiProperty } from "@nestjs/swagger";
import { HealthResponseDto } from "./health-response.dto.js";

ApiProperty({ type: Boolean, example: true })(HealthResponseDto.prototype, "ok");
ApiProperty({
  type: String,
  example: "receive-only",
  description: "Operating mode of the propagator (no `management` adapter).",
})(HealthResponseDto.prototype, "role");
ApiProperty({ type: String, example: "c-nest", description: "Own `AMQP_QUEUE` of this peer." })(
  HealthResponseDto.prototype,
  "peer"
);
