import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

// Side-effect imports: each ./dto/*.openapi attaches @ApiProperty metadata to its DTO classes.
import "./dto/echo-response.openapi.js";
import "./dto/health-response.openapi.js";

import { EchoResponseDto } from "./dto/echo-response.dto.js";
import { HealthResponseDto } from "./dto/health-response.dto.js";

export const EchoApiTag = ApiTags("echo");
export const HealthApiTag = ApiTags("health");

export const EchoApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "HMAC-verified echo",
      description:
        "Reached only after the HMAC middleware accepts the signed request. The body is empty; the response confirms which clientId the verifier resolved.",
    }),
    ApiResponse({ status: 200, type: EchoResponseDto }),
    ApiResponse({ status: 401, description: "HMAC verification failed (BAD_SIGNATURE / UNKNOWN_CLIENT / STALE_NONCE)." })
  );

export const HealthApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "Liveness probe",
      description: "Not behind the HMAC middleware. Returns 200 as long as the Nest app is up.",
    }),
    ApiResponse({ status: 200, type: HealthResponseDto })
  );
