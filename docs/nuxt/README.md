# Nuxt v4 integration

**Docs:** [README](../../README.md) · [Architecture](../architecture.md) · [Wire contract](../wire-contract.md) · [SQL schema](../sql-schema.md) · [TypeORM entities](../entities-nestjs.md) · [Express](../express/README.md) · [NestJS](../nestjs/README.md) · Nuxt · [Next.js](../nextjs/README.md) · [Release notes 1.0.0](../release-notes/1.0.0.md) · [CHANGELOG](../../CHANGELOG.md) · [POC](../../poc/README.md)

---

Nuxt v4 with Nitro server runtime is a natural fit: `server/plugins/` runs on boot,
`server/api/` exposes routes, and the propagator instance can be a singleton stored
in the Nitro app context.

## Plugin: instantiate the propagator on boot

```ts
// server/plugins/00.hmac-runtime.ts
import { createClient } from "redis";
import { initializeHmacHttpAuth, initializeHmacMessageAuth } from "@naskot/node-hmac-auth-core";
import { createPropagator, type PropagationRedisClient, type PendingPropagation } from "@naskot/node-hmac-auth-core-propagation";

export default defineNitroPlugin(async (nitroApp) => {
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
      /* same 8 callbacks as the NestJS guide */
    } as any,
  });

  nitroApp.hooks.hook("close", async () => {
    await propagator.close();
    await redis.disconnect();
  });

  (nitroApp as any).hmac = { auth: hmacHttpAuth, propagator };
});
```

## Server route: drive ensure from a form

```ts
// server/api/propagate.post.ts
import type { NitroApp } from "nitropack";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ clientId: string; secret: string; targets: string[] }>(event);
  const nitroApp = event.context.nitro?.app as NitroApp & { hmac: any };
  const { propagator } = nitroApp.hmac;
  const result = await propagator.ensure({ clientId: body.clientId, secret: body.secret, targets: body.targets });
  return { ok: true, ...result };
});
```

## Server route: read the state of every Redis in the mesh

```ts
// server/api/redis-state.get.ts
import { createClient } from "redis";

const REDIS_URLS = (process.env.PEER_REDIS_URLS ?? "").split(",").filter(Boolean);

export default defineEventHandler(async () => {
  const clients = await Promise.all(
    REDIS_URLS.map(async (url) => {
      const c = createClient({ url });
      await c.connect();
      return c;
    })
  );
  try {
    const out: Record<string, unknown[]> = {};
    for (const c of clients) {
      const keys = await c.keys("hmac:credentials:*");
      const records: unknown[] = [];
      for (const k of keys) {
        const r = await c.hGetAll(k);
        records.push({ key: k, ...r });
      }
      out[c.options?.url ?? "?"] = records;
    }
    return out;
  } finally {
    await Promise.all(clients.map((c) => c.disconnect()));
  }
});
```

## Cron driver

Nitro exposes scheduled tasks via `nitro.experimental.tasks`. Define a task that
calls `propagator.sync()`:

```ts
// server/tasks/propagation-sync.ts
export default defineTask({
  meta: {
    name: "propagation:sync",
    description: "Process pending HMAC propagation rows",
  },
  async run({ payload, context }) {
    const nitroApp = context as any;
    const { propagator } = nitroApp.hmac;
    return await propagator.sync();
  },
});
```

Trigger it from a cron container or from a server-side `setInterval`.

## UI

Tailwind v4 is the recommended styling. The page that drives the form posts to
`/api/propagate` and the dashboard fetches `/api/redis-state` to render what is
actually written in each peer's Redis. See `poc/consumer-nuxt/` for a working
example.
