import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { HmacAuthModule } from "../hmac-auth/hmac-auth.module.js";
import { EchoController } from "./echo.controller.js";
import { HmacVerifierMiddleware } from "./hmac-verifier.middleware.js";

@Module({
  imports: [HmacAuthModule],
  controllers: [EchoController],
  providers: [HmacVerifierMiddleware],
})
export class EchoModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HmacVerifierMiddleware).forRoutes("api/echo");
  }
}
