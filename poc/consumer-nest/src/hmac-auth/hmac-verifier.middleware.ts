import { Inject, Injectable } from "@nestjs/common";
import type { NestMiddleware } from "@nestjs/common";
import { HmacAuthService } from "./hmac-auth.service.js";

// Wraps the core lib's Express-style middleware so Nest can mount it via
// MiddlewareConsumer without the consumer importing express directly.
@Injectable()
export class HmacVerifierMiddleware implements NestMiddleware {
  private wrapped?: (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown;

  constructor(@Inject(HmacAuthService) private readonly hmacAuth: HmacAuthService) {}

  use(req: unknown, res: unknown, next: (err?: unknown) => void) {
    if (!this.wrapped) {
      this.wrapped = this.hmacAuth.http.createExpressHttpMiddleware();
    }
    this.wrapped(req, res, next);
  }
}
