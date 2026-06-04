# Express integration

**Docs:** [README](../../README.md) · [Architecture](../architecture.md) · [Wire contract](../wire-contract.md) · [SQL schema](../sql-schema.md) · [TypeORM entities](../entities-nestjs.md) · Express · [NestJS](../nestjs/README.md) · [Nuxt](../nuxt/README.md) · [Next.js](../nextjs/README.md) · [Release notes 1.0.0](../release-notes/1.0.0.md) · [CHANGELOG](../../CHANGELOG.md) · [POC](../../poc/README.md)

---

The lib does not require Express. The two ways it shows up in an Express app:

1. **As a peer that consumes HMAC-signed inbound requests** via the core lib's
   `createExpressHttpHmacMiddleware`, while the propagation lib runs in the
   background as a receive-only consumer or full-mode peer.
2. **As a peer that signs outbound requests** via the core lib's
   `createHttpSignedFetchClient`, with credentials kept fresh by the propagation
   lib via the receive loop.

## Receive-only peer

```ts
import express from "express";
import { createClient } from "redis";
import {
  captureRawBody,
  createExpressHttpHmacMiddleware,
  initializeHmacHttpAuth,
  initializeHmacMessageAuth,
} from "@naskot/node-hmac-auth-core";
import { createPropagator, type PropagationRedisClient } from "@naskot/node-hmac-auth-core-propagation";

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
});

const app = express();
app.use(express.json({ verify: captureRawBody }));
app.use("/api", createExpressHttpHmacMiddleware(hmacHttpAuth));

app.get("/api/echo", (req, res) => {
  res.json({ ok: true, clientId: (req as any).hmacAuth?.clientId });
});

const server = app.listen(Number(process.env.PORT ?? 3000));

process.on("SIGTERM", async () => {
  server.close();
  await propagator.close();
  await redis.disconnect();
});
```

The receive loop in `propagator` applies every valid `credential.create / update /
delete` event published by the mesh authority. The Express app does nothing special
on these events: `hmacHttpAuth.clients.setSecretHash` is invoked inside the lib,
the next HMAC-signed request signed with the new secret will pass verification.

## Full-mode peer (signs and verifies)

Identical to the snippet above, plus a `management:` adapter that backs onto your
storage of choice (the lib does not require a specific BDD). See the NestJS guide
for a TypeORM-backed example transposable to Express + Knex / Prisma / raw SQL.

## Outbound signed call from Express

```ts
const fetchSigned = hmacHttpAuth.createHttpSignedFetchClient({
  clientId: "client_demo",
  secret: process.env.CLIENT_DEMO_SECRET!,
});

await fetchSigned("http://peer.local/api/echo", { method: "GET" });
```

The credential `client_demo` was provisioned by the mesh authority and propagated
via this peer's receive loop. The Express code does not call any propagation
helper.
