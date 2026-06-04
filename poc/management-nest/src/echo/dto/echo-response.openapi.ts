import { ApiProperty } from "@nestjs/swagger";
import { EchoResponseDto } from "./echo-response.dto.js";

ApiProperty({ type: Boolean, example: true })(EchoResponseDto.prototype, "ok");
ApiProperty({ type: String, example: "mgmt-nest" })(EchoResponseDto.prototype, "peer");
ApiProperty({ type: String, required: false, example: "client_partner_a" })(EchoResponseDto.prototype, "clientId");
