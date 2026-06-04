# @naskot/node-hmac-auth-core-propagation

[![npm version](https://img.shields.io/npm/v/%40naskot%2Fnode-hmac-auth-core-propagation?style=flat-square&color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@naskot/node-hmac-auth-core-propagation)
[![TypeScript Ready](https://img.shields.io/badge/TypeScript-Ready-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![peer @naskot/node-hmac-auth-core ^1.0.0](https://img.shields.io/badge/peer-%40naskot%2Fnode--hmac--auth--core%20%5E1.0.0-8a2be2?style=flat-square)](https://www.npmjs.com/package/@naskot/node-hmac-auth-core)
[![AMQP RabbitMQ](https://img.shields.io/badge/AMQP-RabbitMQ%203.x-ff6600?style=flat-square&logo=rabbitmq&logoColor=white)](https://www.rabbitmq.com/)
[![Redis required](https://img.shields.io/badge/Redis-required-dc382d?style=flat-square&logo=redis&logoColor=white)](https://redis.io/)
[![License: MIT](https://img.shields.io/badge/license-MIT-3da639?style=flat-square)](https://opensource.org/licenses/MIT)

**Docs:** README · [Architecture](./docs/architecture.md) · [Wire contract](./docs/wire-contract.md) · [SQL schema](./docs/sql-schema.md) · [TypeORM entities](./docs/entities-nestjs.md) · [Express](./docs/express/README.md) · [NestJS](./docs/nestjs/README.md) · [Nuxt](./docs/nuxt/README.md) · [Next.js](./docs/nextjs/README.md) · [Release notes 1.0.0](./docs/release-notes/1.0.0.md) · [CHANGELOG](./CHANGELOG.md) · [POC](./poc/README.md)

---

RabbitMQ-backed credential propagation layer on top of
[@naskot/node-hmac-auth-core](https://github.com/padcmoi/node-hmac-auth-core).

Two modes:

- **Receive-only** (no `management` adapter): consumes events from the mesh,
  applies them locally via `hmacAuth.clients.*`, publishes the return ACK.
- **Full mode** (8 callbacks in `management`): in addition to receive-only, the
  peer can drive credentials via `ensure / rotate / revoke / sync`. The lib
  publishes one event per target, signed with that target's `propagationSecret`.

RabbitMQ is never visible at usage time. The application calls high-level
helpers; the lib drives AMQP internally.

## Install

```sh
npm install @naskot/node-hmac-auth-core-propagation @naskot/node-hmac-auth-core amqplib redis
```

`@naskot/node-hmac-auth-core` is a peer dep. `amqplib` is a runtime dep. A node-redis
v4+ client (or any client matching the same camelCase shape) is required at runtime
because the lib uses Redis for the monotonic cursor and the ack store.

## Usage in 30 seconds (full mode)

```ts
import { createClient } from "redis";
import type { RedisLikeClient } from "@naskot/node-hmac-auth-core";
import { initializeHmacHttpAuth, initializeHmacMessageAuth } from "@naskot/node-hmac-auth-core";
import type { PropagationRedisClient } from "@naskot/node-hmac-auth-core-propagation";
import { createPropagator } from "@naskot/node-hmac-auth-core-propagation";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

// node-redis's `createClient` returns a deeply-overloaded type (`RedisClientType<...>`
// with hundreds of method overloads). Our two interfaces are intentionally minimal
// subsets of that surface, so TypeScript's structural check on the overloads fails
// without an explicit cast. We do it ONCE here instead of at every call site.
const redisClient = redis as unknown as RedisLikeClient & PropagationRedisClient;

// HTTP track: verifies signed HTTP requests, signs outbound calls.
// Namespace "hmac:http" → keys land under `hmac:http:clients`, `hmac:http:credentials-backup:*`, ...
// `:` is the canonical Redis separator; GUIs (RedisInsight, redis-commander, ...)
// render keys as a clean sub-tree `hmac > http > ...`.
const hmacHttpAuth = initializeHmacHttpAuth({
  redis: redisClient,
  namespace: "hmac:http",
  secretToken: process.env.HMAC_SECRET_TOKEN,
});

// Message track: signs/verifies non-HTTP payloads (AMQP business messages,
// Kafka, etc.). Lives on a sibling sub-tree `hmac > message > ...` so HTTP
// and message credentials never share a key.
const hmacMessageAuth = initializeHmacMessageAuth({
  redis: redisClient,
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
  redis: redisClient,
  // Pass either or both. The lib routes each propagation to the matching
  // store based on `track: "http" | "message"` on the pending row.
  hmacHttpAuth,
  hmacMessageAuth,
  management: {
    upsertCredentialWithTargets: async (input) => {
      /* INSERT/UPSERT your 4-table schema, status='pending' on the pivot */
    },
    rotateCredentialSecret: async (input) => {
      /* UPDATE the plain on Table 1 + reset Table 3 to status='pending' */
    },
    fetchPendingPropagations: async () => {
      /* JOIN Table 1 + Table 3 + Table 2, return PendingPropagation[] */
      return [];
    },
    fetchSourcePropagationSecret: async (senderAmqpQueue) => {
      /* SELECT propagation_secret FROM Table 2 WHERE target_amqp_queue = ? */
      return null;
    },
    markTargetSent: async () => {
      /* UPDATE Table 3 SET status='sent', sent_at=?, attempt_count=? */
    },
    markTargetSuccess: async () => {
      /* UPDATE Table 3 SET status='success', applied_at=? */
    },
    markTargetError: async () => {
      /* UPDATE Table 3 SET status='error', failed_at=?, reason=? */
    },
    markCredentialFullyPropagated: async () => {
      /* UPDATE Table 1 SET secret_plain = NULL */
    },
  },
});

await propagator.ensure({
  clientId: "client_partner_a",
  secret: "plain-text-secret",
  targets: ["x-ged-extract-mistral", "docker-nestjs-template"],
});

// From your cron:
await propagator.sync();
```

Full per-framework guides:

- [docs/express/README.md](./docs/express/README.md)
- [docs/nestjs/README.md](./docs/nestjs/README.md)
- [docs/nuxt/README.md](./docs/nuxt/README.md)
- [docs/nextjs/README.md](./docs/nextjs/README.md)

## Receive-only mode

Omit `management` from `createPropagator(...)`. The peer consumes events, applies
them locally, publishes the return ACK with an empty `propagationSecret` (the source
warn-drops it but the local apply has already happened). `ensure/rotate/revoke/sync`
throw `HmacPropagationError("MANAGEMENT_NOT_CONFIGURED")`.

## Surface

| Helper                | Mode   | What                                                                                                                  |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `propagator.close()`  | always | Graceful shutdown of the AMQP connection and the consume loop                                                         |
| `propagator.ensure()` | full   | Add or update a credential, write its targets in `status='pending'`, **apply locally immediately** (no target needed) |
| `propagator.rotate()` | full   | Rotate the plain for an existing clientId, **apply the new hash locally immediately**                                 |
| `propagator.revoke()` | full   | Delete propagated: NULL the plain on Table 1, repropagate `credential.delete`, **drop locally immediately**           |
| `propagator.sync()`   | full   | Read pending rows, apply locally, publish one event per target with target secret                                     |

## SQL schema and TypeORM entities

The lib does not impose a schema; it only requires the callbacks to honor the input
and output contracts. A reference 4-table MariaDB schema and ready-to-copy TypeORM
entities live in [docs/sql-schema.md](./docs/sql-schema.md) and
[docs/entities-nestjs.md](./docs/entities-nestjs.md).

## Wire specification

The wire is frozen at v1. The apply and ack event shapes are documented in
[docs/wire-contract.md](./docs/wire-contract.md) so peer implementations in other
languages can interoperate without code-sharing.

## POC

End-to-end demonstration in `poc/`:

- 1 NestJS authority (`management-nest`) with MariaDB schema `mgmt`
- 1 NestJS receive-only consumer (`consumer-nest`)
- 1 Nuxt v4 + Tailwind v4 full-mode peer (`consumer-nuxt`) with MariaDB schema `nuxt`
- 1 Next.js v15 + Tailwind v4 full-mode peer (`consumer-next`) with MariaDB schema `next`
- 1 RabbitMQ, 1 MariaDB, 4 Redis (one per peer)

```sh
cd poc && docker compose up --build
```

Nuxt and Next expose a UI that lists the state of the 4 Redis instances and lets
the operator drive `ensure` from a form.

## Compatibility

Same notation as `package.json`. Caret ranges only: the table never claims an
upper bound that does not exist yet; bumping a major on either side replaces the
row.

| `@naskot/node-hmac-auth-core` (peer dep) | `@naskot/node-hmac-auth-core-propagation` | Notes                                                     |
| ---------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `^1.0.0`                                 | `^1.0.0`                                  | Wire contract pinned `v1`. Latest released: core `1.0.0`. |

## Background

`@naskot/node-hmac-auth-core` is the auth primitives (sign, verify, manage
credentials). This package is the orchestration layer that distributes those
credentials across a mesh of peers over RabbitMQ. Together they reproduce the
behavior of the deprecated `@naskot/node-hmac-auth` 1.x but with two clean
boundaries:

- The core knows nothing about the mesh and can be used standalone.
- The propagation layer takes the core as a peer dep and adds RabbitMQ.

The decision to split was driven by single-responsibility: an HMAC verifier
should not also be a credential-distribution agent.

## License

MIT, see [LICENSE](./LICENSE).
