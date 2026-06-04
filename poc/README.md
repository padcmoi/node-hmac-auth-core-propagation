# POC

**Docs:** [README](../README.md) · [Architecture](../docs/architecture.md) · [Wire contract](../docs/wire-contract.md) · [SQL schema](../docs/sql-schema.md) · [TypeORM entities](../docs/entities-nestjs.md) · [Express](../docs/express/README.md) · [NestJS](../docs/nestjs/README.md) · [Nuxt](../docs/nuxt/README.md) · [Next.js](../docs/nextjs/README.md) · [Release notes 1.0.0](../docs/release-notes/1.0.0.md) · [CHANGELOG](../CHANGELOG.md) · POC

---

End-to-end demonstration of `@naskot/node-hmac-auth-core-propagation` 1.0.0 and
its peer dep `@naskot/node-hmac-auth-core` 1.0.0.

## Topology

| Service           | Role                                                       | Mode         | Port |
| ----------------- | ---------------------------------------------------------- | ------------ | ---- |
| `rabbitmq`        | Broker. Vhost `hmac-credentials`, mgmt UI on 15672         | -            | 5672 |
| `mariadb`         | Three schemas: `nest_db`, `nuxt_db`, `next_db`             | -            | 3306 |
| `phpmyadmin`      | Web UI for the MariaDB instance, auto-logs in as root      | -            | 8080 |
| `redis-mgmt`      | Redis for the NestJS authority                             | -            | -    |
| `redis-c-nest`    | Redis for the NestJS receive-only consumer                 | -            | -    |
| `redis-nuxt`      | Redis for the Nuxt v4 peer                                 | -            | -    |
| `redis-next`      | Redis for the Next.js 15 peer                              | -            | -    |
| `management-nest` | NestJS authority. Drives ensure/rotate/revoke + sync cron  | full mode    | 3001 |
| `consumer-nest`   | NestJS peer with HMAC verifier. No management adapter      | receive-only | 3002 |
| `consumer-nuxt`   | Nuxt v4 + Tailwind v4. Own MariaDB schema. UI dashboard    | full mode    | 3003 |
| `consumer-next`   | Next.js 15 + Tailwind v4. Own MariaDB schema. UI dashboard | full mode    | 3004 |

**Secrets layout.** Each peer carries its **own** `HMAC_SECRET_TOKEN` (a private
pepper used to hash the plain into the stored hash). The lib propagates the
already-computed hash on the wire; remote peers store it as-is and never need to
re-compute it, so peppers are not shared. Each peer also has its own
`PROPAGATION_SECRET`, used to sign outbound events. Table 2 in every authority
schema seeds the propagation secrets of the other peers.

## Libs

Both libs are packed as tgz in `libs/`:

- `libs/naskot-node-hmac-auth-core-1.0.0.tgz`
- `libs/naskot-node-hmac-auth-core-propagation-1.0.0.tgz`

Each app installs them via `file:./libs/...` references in its `package.json`.

## Run

```sh
docker compose up --build
```

Wait for every service to print its bootstrap line. RabbitMQ takes ~10 seconds to
become healthy on first boot.

Tear down:

```sh
docker compose down -v
```

## Scenarios

The `management-nest` authority exposes an admin HTTP API:

- `POST /admin/ensure         { clientId, secret, targets[] }` propagate add/update
- `POST /admin/rotate         { clientId, secret }` rotate the plain
- `POST /admin/revoke         { clientId, targets[] }` propagate delete
- `POST /admin/sync` run sync now
- `GET  /admin/state` inspect the 4 tables
- `POST /admin/targets        { targetAmqpQueue, propagationSecret, note? }` upsert a peer in Table 2
- `DELETE /admin/targets/:q` drop a peer from Table 2 (refuses the self-target)

The Nuxt and Next.js peers expose the same surface under `/api/*` plus a
`/api/targets` route (POST upsert, DELETE `/api/targets/:queue`).

### 1. ensure + sync

```sh
curl -s -X POST http://localhost:3001/admin/ensure \
  -H "content-type: application/json" \
  -d '{"clientId":"client_demo","secret":"plain-text-secret",
       "targets":["c-nest","nuxt","next"]}'

curl -s -X POST http://localhost:3001/admin/sync
```

Check that `client_demo` now exists in every peer's Redis:

```sh
docker exec hmac-poc-redis-mgmt   redis-cli HGETALL hmac:http:clients
docker exec hmac-poc-redis-c-nest redis-cli HGETALL hmac:http:clients
docker exec hmac-poc-redis-nuxt   redis-cli HGETALL hmac:http:clients
docker exec hmac-poc-redis-next   redis-cli HGETALL hmac:http:clients
```

### 2. signed call from authority to consumer-nest

```sh
curl -s -X POST http://localhost:3001/admin/call-target \
  -H "content-type: application/json" \
  -d '{"target":"http://consumer-nest:3002/api/echo","clientId":"client_demo","secret":"plain-text-secret"}'
```

The NestJS consumer returns `{ ok: true, clientId: "client_demo" }`, proving the
hash arrived intact via the propagation pipeline.

### 3. rotate

```sh
curl -s -X POST http://localhost:3001/admin/rotate \
  -H "content-type: application/json" \
  -d '{"clientId":"client_demo","secret":"new-plain-secret"}'

curl -s -X POST http://localhost:3001/admin/sync
```

Subsequent signed calls must use the new secret; the old one is rejected by every
peer.

### 4. revoke

```sh
curl -s -X POST http://localhost:3001/admin/revoke \
  -H "content-type: application/json" \
  -d '{"clientId":"client_demo","targets":["c-nest","nuxt","next"]}'

curl -s -X POST http://localhost:3001/admin/sync
```

`client_demo` disappears from every peer's Redis.

### 5. drive ensure from the Nuxt UI

Open <http://localhost:3003> in a browser. The dashboard reads the state of all 4
Redis instances. Submit the form to call `propagator.ensure(...)` against the Nuxt
authority and watch the propagation roll across the mesh. The Next.js peer at
<http://localhost:3004> has the same UI on its own MariaDB schema.

The dashboards live-tail at 1 Hz: the "All peers' Redis (direct connection)"
panel and the "ClientId (local)" dropdown both refresh every second so the effect
of an ensure/rotate/revoke is visible without manual reload.

### 6. add/remove a propagation target

From the Nuxt UI section "Propagation targets (Table 2)" (or the corresponding
section on Next, or the curl below against mgmt-nest), upsert a new peer into
Table 2 and watch subsequent ensures fan out to it. The self-target row is
visually locked: deleting it would break inbound ACK signing.

```sh
curl -s -X POST http://localhost:3001/admin/targets \
  -H "content-type: application/json" \
  -d '{"targetAmqpQueue":"partner-x","propagationSecret":"secret-of-partner-x","note":"demo"}'

curl -s -X DELETE http://localhost:3001/admin/targets/partner-x
```

## Local dev (pnpm dev outside Docker)

The compose file publishes every Redis on a distinct host port
(`6379` mgmt, `6380` c-nest, `6381` nuxt, `6382` next) plus MariaDB (`3306`) and
RabbitMQ (`5672`). Each Nuxt / Next consumer ships a `.env` (committed) that
points every connection at `localhost:<port>`. To dev one peer locally:

```sh
docker compose stop consumer-nuxt        # free the 3003 port + AMQP queue
cd consumer-nuxt && pnpm dev
```

Same for `consumer-next` on 3004. The `.dockerignore` excludes the local `.env*`
files from the image so the Docker container keeps using its compose-injected
environment.
