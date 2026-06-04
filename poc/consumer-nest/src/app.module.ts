import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { EchoController, HealthController } from "./echo/echo.controller.js";
import { HmacAuthModule } from "./hmac-auth/hmac-auth.module.js";
import { HmacVerifierMiddleware } from "./hmac-auth/hmac-verifier.middleware.js";
import { HmacPropagatorModule } from "./hmac-propagator/hmac-propagator.module.js";

@Module({
  imports: [HmacAuthModule, HmacPropagatorModule],
  controllers: [EchoController, HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HmacVerifierMiddleware).forRoutes("api");
  }
}
