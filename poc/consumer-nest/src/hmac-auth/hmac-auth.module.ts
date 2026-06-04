import { Module } from "@nestjs/common";
import { HmacAuthService } from "./hmac-auth.service.js";

@Module({
  providers: [HmacAuthService],
  exports: [HmacAuthService],
})
export class HmacAuthModule {}
