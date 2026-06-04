import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import "./dto/echo-response.openapi.js";
import { EchoResponseDto } from "./dto/echo-response.dto.js";

export const EchoApiTag = ApiTags("echo");

export const EchoApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "HMAC-verified echo",
      description: "Behind the HMAC middleware. Confirms the propagated credential verifies end-to-end on this peer.",
    }),
    ApiResponse({ status: 200, type: EchoResponseDto }),
    ApiResponse({ status: 401, description: "HMAC verification failed." })
  );
