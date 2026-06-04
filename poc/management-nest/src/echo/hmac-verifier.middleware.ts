import { Inject, Injectable } from "@nestjs/common";
import type { NestMiddleware } from "@nestjs/common";
import { HmacAuthService } from "../hmac-auth/hmac-auth.service.js";

interface InboundReq {
  method: string;
  url?: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  rawBody?: unknown;
  hmacAuth?: unknown;
}

interface OutboundRes {
  status: (code: number) => OutboundRes;
  json: (payload: unknown) => unknown;
}

// Direct call into the instance's `verifyHttpSignature` so we control the rawBody.
// Nest's default json body parser initializes `req.body` to `{}` even on bodyless GET,
// which the helper `fallbackRawBody` would stringify to "{}" and mismatch the
// client's empty signing payload. For GET we force rawBody="".
@Injectable()
export class HmacVerifierMiddleware implements NestMiddleware {
  constructor(@Inject(HmacAuthService) private readonly hmacAuth: HmacAuthService) {}

  async use(req: InboundReq, res: OutboundRes, next: (err?: unknown) => void) {
    try {
      const rawBody =
        req.method === "GET"
          ? ""
          : req.rawBody != null
            ? (req.rawBody as Buffer | string)
            : req.body == null
              ? ""
              : typeof req.body === "string"
                ? req.body
                : JSON.stringify(req.body);

      const verified = await this.hmacAuth.http.verifyHttpSignature({
        method: req.method,
        path: req.originalUrl ?? req.url ?? "/",
        headers: req.headers,
        rawBody,
      });
      req.hmacAuth = verified;
      next();
    } catch (err) {
      const code = (err as { code?: string }).code ?? "UNAUTHORIZED";
      const message = (err as Error).message ?? "Unauthorized";
      const status = (err as { status?: number }).status ?? 401;
      res.status(status).json({ error: code, message });
    }
  }
}
