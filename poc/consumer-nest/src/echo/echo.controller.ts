import { Controller, Get, Req } from "@nestjs/common";
import { EchoResponseDto } from "./dto/echo-response.dto.js";
import { HealthResponseDto } from "./dto/health-response.dto.js";
import { EchoApi, EchoApiTag, HealthApi, HealthApiTag } from "./echo.openapi.js";

interface HmacAttachedRequest {
  hmacAuth?: { clientId?: string };
}

@EchoApiTag
@Controller("api")
export class EchoController {
  @Get("echo")
  @EchoApi()
  echo(@Req() req: HmacAttachedRequest): EchoResponseDto {
    return { ok: true, peer: process.env.AMQP_QUEUE ?? "", clientId: req.hmacAuth?.clientId };
  }
}

@HealthApiTag
@Controller()
export class HealthController {
  @Get("health")
  @HealthApi()
  health(): HealthResponseDto {
    return { ok: true, role: "receive-only", peer: process.env.AMQP_QUEUE ?? "" };
  }
}
