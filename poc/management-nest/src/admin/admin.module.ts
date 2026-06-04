import { Module } from "@nestjs/common";
import { HmacAuthModule } from "../hmac-auth/hmac-auth.module.js";
import { HmacPropagationDataModule } from "../hmac-propagation-data/hmac-propagation-data.module.js";
import { HmacPropagatorModule } from "../hmac-propagator/hmac-propagator.module.js";
import { AdminController } from "./admin.controller.js";

@Module({
  imports: [HmacAuthModule, HmacPropagatorModule, HmacPropagationDataModule],
  controllers: [AdminController],
})
export class AdminModule {}
