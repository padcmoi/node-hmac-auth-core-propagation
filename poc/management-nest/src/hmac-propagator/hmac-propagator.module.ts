import { Module } from "@nestjs/common";
import { HmacAuthModule } from "../hmac-auth/hmac-auth.module.js";
import { HmacPropagationDataModule } from "../hmac-propagation-data/hmac-propagation-data.module.js";
import { HmacPropagatorService } from "./hmac-propagator.service.js";
import { SyncCron } from "./sync.cron.js";

@Module({
  imports: [HmacAuthModule, HmacPropagationDataModule],
  providers: [HmacPropagatorService, SyncCron],
  exports: [HmacPropagatorService],
})
export class HmacPropagatorModule {}
