# Architecture

**Docs:** [README](../README.md) · Architecture · [Wire contract](./wire-contract.md) · [SQL schema](./sql-schema.md) · [TypeORM entities](./entities-nestjs.md) · [Express](./express/README.md) · [NestJS](./nestjs/README.md) · [Nuxt](./nuxt/README.md) · [Next.js](./nextjs/README.md) · [Release notes 1.0.0](./release-notes/1.0.0.md) · [CHANGELOG](../CHANGELOG.md) · [POC](../poc/README.md)

---

## Components

```
+--------------------+     +-----------------+     +-------------------+
|  Consumer code     |     |  This library   |     |  RabbitMQ broker  |
|  (NestJS / Nuxt /  |     |  createPropag.. |     |  vhost            |
|   Next / Express)  |     |                 |     |  hmac-credentials |
|                    |     |                 |     |                   |
|  ensure/rotate/    +---->|  helpers        +---->|  one queue per    |
|  revoke/sync       |     |  +sync orch.    |     |  peer:            |
|                    |     |  +consume loop  |     |  hmac-<q>.queue   |
+--------------------+     |  +cursor (Redis)|     |                   |
                           |  +ack-store     |     +-------------------+
                           |   (Redis)       |
                           +---------+-------+
                                     |
                                     v
                           +---------+--------+
                           |  @naskot/        |
                           |  node-hmac-auth- |
                           |  core            |
                           |  clients.set/    |
                           |  delete          |
                           +------------------+
```

## File layout

```
src/
  errors.ts         HmacPropagationError + code union
  types.ts          PropagatorOptions, Propagator, PropagatorManagement, wire events
  wire.ts           encode/decode events, queue name builder, secret matcher
  cursor.ts         monotonic cursor read/write per (track, clientId)
  ack-store.ts      Redis bookkeeping of in-flight events + per-client aggregation
  transport.ts      amqplib wrapper: connect, declare, consume, publish with confirms
  sync.ts           outbound pipeline: enrich + hash + apply local + publish per target
  consume.ts        inbound pipeline: verify secret, apply, publish ACK back
  propagator.ts     createPropagator factory + helpers ensure/rotate/revoke/sync/close
  index.ts          public re-exports
```

## Two modes

### Receive-only

`createPropagator({...})` without `management`. The lib:

1. Connects to RabbitMQ.
2. Declares its own queue `hmac-<amqpQueue>.queue` (durable).
3. Starts consuming with prefetch=1.
4. For each inbound event:
   - verifies `event.propagationSecret === options.propagationSecret` via `timingSafeEqual`
   - if mismatch, ack and warn (drop)
   - if apply event, run the monotonic cursor + call `hmacAuth.clients.setSecretHash` or `.delete`
   - publish the return ACK with `propagationSecret = ""` (no management to resolve the source secret)
5. Throws `MANAGEMENT_NOT_CONFIGURED` on any call to `ensure/rotate/revoke/sync`.

### Full mode

`createPropagator({...management: {...}})`. In addition to receive-only:

- `ensure(input)`: delegate to `management.upsertCredentialWithTargets`, then
  apply locally (`hashClientSecret` + `setSecretHash`) so the credential is usable
  on the originating peer immediately even if no remote target is selected.
- `rotate(input)`: verify the client exists in `hmacAuth.clients.get`, delegate to
  `management.rotateCredentialSecret`, then apply the new hash locally so the
  rotate takes effect on this peer right away.
- `revoke(input)`: delegate to `management.upsertCredentialWithTargets` with
  `op="credential.delete"`, then drop the credential locally via `clients.delete`.
- `sync()`: read pending propagations from `management.fetchPendingPropagations`
  (must return only rows in `status='pending'`), enrich each plain with a UUID,
  hash via `hashClientSecret`, apply locally (idempotent), publish one event per
  target with the target's `propagationSecret`, record the in-flight in the Redis
  ack store, call `markTargetSent` per target.
- The inbound ACK pipeline is also management-aware: it resolves the source's secret
  via `fetchSourcePropagationSecret`, calls `markTargetSuccess`/`markTargetError`,
  and when the pending set for the client becomes empty calls
  `markCredentialFullyPropagated` with the aggregated `finalStatus`.

## AMQP topology

- Default exchange `""` (built-in direct).
- One durable queue per peer, name `hmac-<amqpQueue>.queue`.
- `routingKey = queue name`. Targeting is per message.
- Vhost `hmac-credentials` (literal default).
- `prefetch=1`, `publisherConfirms=true`, `heartbeat=10s`.
- No DLQ. Transient failures NACK requeue=true.
- **Deferred `basic.consume` registration.** The transport opens the connection +
  channels + `assertQueue` synchronously at boot, but it does **not** register the
  consumer callback until the propagator has installed the real message handler
  and calls `transport.startConsume()`. Without this, a redelivered message could
  race the no-op placeholder handler, sit Unacked forever on the channel, and
  freeze the consumer (prefetch=1). The deferred-consume pattern guarantees that
  every restart picks up its full queue regardless of message age.

## Redis layout

- `propagation:last-seen:<track>:<clientId>` HSET (ts, eventId). No TTL.
- `propagation:ack:<eventId>` HSET (clientId, targetAmqpQueue, attemptCount, sentAt). TTL 7 days.
- `propagation:client-pending:<clientId>` SET of pending eventIds. TTL 7 days.
- `propagation:client-results:<clientId>` HSET (target -> "success" | "error"). TTL 7 days.

## Trust model

Three roles for `propagationSecret`:

| Role                                 | Where it lives                                         | Used for                               |
| ------------------------------------ | ------------------------------------------------------ | -------------------------------------- |
| The peer's own env                   | `.env` of the peer                                     | Verify inbound events on its own queue |
| The secret of each target            | Table 2 (`hmac_propagation_target.propagation_secret`) | Sign outbound events to that target    |
| The secret of each source (symmetry) | Same Table 2 by symmetry                               | Sign the return ACK to that source     |

Each peer has its own `propagationSecret`. Compromise of a single peer does not
forge the rest of the mesh. Rotation of a peer's secret is out of scope of the lib
(operator runbook).

## Guarantees

- **0 desync**. A credential row stays in `status='pending'` until terminal. No DLQ.
- **Strict obedience to RabbitMQ**. Any valid inbound event is applied locally even
  in receive-only mode; the local store is the source of truth for the verifier.
  The only valid reasons to drop an inbound message are: `propagationSecret`
  mismatch (security), stale event vs the local monotonic cursor (anti-regression),
  or malformed payload.
- **Zero-loss on restart**. A peer that comes back UP after being down for any
  duration drains its queue in FIFO order with no message left behind, thanks to
  durable queues + persistent messages + deferred `basic.consume` + 10s heartbeat.
- **Publish-once on the broker**. The adapter only republishes rows in
  `status='pending'`; `sent` rows wait for the target's ACK back to flip them to
  `success`. A target offline for a week sees ONE message per (clientId, target)
  in its queue, not thousands.
- **Plain transiently in the operator's BDD**. NULL'd via the
  `markCredentialFullyPropagated` callback once all targets are terminal. Never on
  the wire.

## What the lib does not do

- Open an HTTP server.
- Schedule its own cron; the consumer calls `sync()` on its own cadence.
- Read `.env`.
- Provision Table 2.
- Implement Table 4 (audit). The consumer can insert into its own audit from inside
  the callbacks `markTarget*`.
- Snapshot and bootstrap a new peer. Targets propagate one message per change; new
  peers receive nothing retroactively (v2 territory).
