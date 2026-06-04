# Next.js v15 integration

**Docs:** [README](../../README.md) · [Architecture](../architecture.md) · [Wire contract](../wire-contract.md) · [SQL schema](../sql-schema.md) · [TypeORM entities](../entities-nestjs.md) · [Express](../express/README.md) · [NestJS](../nestjs/README.md) · [Nuxt](../nuxt/README.md) · Next.js · [Release notes 1.0.0](../release-notes/1.0.0.md) · [CHANGELOG](../../CHANGELOG.md) · [POC](../../poc/README.md)

---

Next 15 App Router. The propagator is instantiated once in a server-only module
and reused across route handlers. The lib has no React surface; it lives entirely
on the server.

## Singleton on the server

```ts
// src/lib/hmac-runtime.ts
import "server-only";
import { createClient } from "redis";
import { initializeHmacHttpAuth, initializeHmacMessageAuth } from "@naskot/node-hmac-auth-core";
import { createPropagator, type PropagationRedisClient } from "@naskot/node-hmac-auth-core-propagation";

declare global {
  var __hmacRuntime: { propagator: any; hmacHttpAuth: any; hmacMessageAuth: any; redis: any } | undefined;
}

export async function getHmacRuntime() {
  if (global.__hmacRuntime) return global.__hmacRuntime;

  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();

  // HTTP track on sub-tree `hmac:http:*`.
  const hmacHttpAuth = initializeHmacHttpAuth({
    redis: redis as never,
    namespace: "hmac:http",
    secretToken: process.env.HMAC_SECRET_TOKEN,
  });

  // Message track on sibling sub-tree `hmac:message:*`.
  const hmacMessageAuth = initializeHmacMessageAuth({
    redis: redis as never,
    namespace: "hmac:message",
    secretToken: process.env.HMAC_SECRET_TOKEN,
  });

  const propagator = await createPropagator({
    amqpHost: process.env.AMQP_HOST!,
    amqpPort: Number(process.env.AMQP_PORT ?? 5672),
    amqpUser: process.env.AMQP_USER!,
    amqpPassword: process.env.AMQP_PASSWORD!,
    amqpProtocol: "amqp",
    amqpQueue: process.env.AMQP_QUEUE!,
    propagationSecret: process.env.PROPAGATION_SECRET!,
    redis: redis as unknown as PropagationRedisClient,
    hmacHttpAuth,
    hmacMessageAuth,
    management: {
      /* 8 callbacks against MariaDB, see NestJS guide */
    } as any,
  });

  global.__hmacRuntime = { propagator, hmacHttpAuth, hmacMessageAuth, redis };
  return global.__hmacRuntime;
}
```

## Route handler: ensure

```ts
// src/app/api/propagate/route.ts
import { NextResponse } from "next/server";
import { getHmacRuntime } from "@/lib/hmac-runtime";

export async function POST(req: Request) {
  const body = (await req.json()) as { clientId: string; secret: string; targets: string[] };
  const { propagator } = await getHmacRuntime();
  const result = await propagator.ensure({ clientId: body.clientId, secret: body.secret, targets: body.targets });
  return NextResponse.json({ ok: true, ...result });
}
```

## Route handler: read every Redis

```ts
// src/app/api/redis-state/route.ts
import { NextResponse } from "next/server";
import { createClient } from "redis";

const REDIS_URLS = (process.env.PEER_REDIS_URLS ?? "").split(",").filter(Boolean);

export async function GET() {
  const out: Record<string, unknown[]> = {};
  await Promise.all(
    REDIS_URLS.map(async (url) => {
      const c = createClient({ url });
      await c.connect();
      try {
        const keys = await c.keys("hmac:credentials:*");
        const rows: unknown[] = [];
        for (const k of keys) rows.push({ key: k, ...(await c.hGetAll(k)) });
        out[url] = rows;
      } finally {
        await c.disconnect();
      }
    })
  );
  return NextResponse.json(out);
}
```

## Eager boot via `instrumentation.ts`

Next has no native server-boot plugin like Nuxt's nitro plugins. A lazy singleton
that's only awaited inside route handlers will **never subscribe to the AMQP
queue until a request hits a route that touches the propagator** — propagation
events pile up undelivered in the meantime. Use `src/instrumentation.ts` (stable
in Next 15) to force-boot the runtime when the server process starts:

```ts
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getHmacRuntime } = await import("@/lib/hmac-runtime");
  await getHmacRuntime();
}
```

After this, the propagator's AMQP consumer is subscribed before any HTTP
request, just like Nuxt's nitro plugin pattern.

## Cron sync

`vercel.json` (cron jobs) or a sidecar container that POSTs to a `/api/sync` route
handler which calls `propagator.sync()`. Next has no native scheduler; pick the
runtime that fits.

```ts
// src/app/api/sync/route.ts
import { NextResponse } from "next/server";
import { getHmacRuntime } from "@/lib/hmac-runtime";

export async function POST() {
  const { propagator } = await getHmacRuntime();
  const summary = await propagator.sync();
  return NextResponse.json(summary);
}
```

## UI

Tailwind v4 styling, server component for the dashboard, client component for the
form. The form POSTs to `/api/propagate`; the dashboard fetches `/api/redis-state`
to render the per-peer view. See `poc/consumer-next/` for a working example.
