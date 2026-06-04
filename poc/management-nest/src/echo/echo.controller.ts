import { Controller, Get, Req } from "@nestjs/common";
import { EchoResponseDto } from "./dto/echo-response.dto.js";
import { EchoApi, EchoApiTag } from "./echo.openapi.js";

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
