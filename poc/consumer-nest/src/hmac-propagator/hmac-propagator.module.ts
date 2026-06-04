import { Module } from "@nestjs/common";
import { HmacAuthModule } from "../hmac-auth/hmac-auth.module.js";
import { HmacPropagatorService } from "./hmac-propagator.service.js";

@Module({
  imports: [HmacAuthModule],
  providers: [HmacPropagatorService],
  exports: [HmacPropagatorService],
})
export class HmacPropagatorModule {}
