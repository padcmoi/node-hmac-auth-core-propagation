# Wire contract v1

**Docs:** [README](../README.md) · [Architecture](./architecture.md) · Wire contract · [SQL schema](./sql-schema.md) · [TypeORM entities](./entities-nestjs.md) · [Express](./express/README.md) · [NestJS](./nestjs/README.md) · [Nuxt](./nuxt/README.md) · [Next.js](./nextjs/README.md) · [Release notes 1.0.0](./release-notes/1.0.0.md) · [CHANGELOG](../CHANGELOG.md) · [POC](../poc/README.md)

---

This contract is frozen for the entire `1.x` line. Any breaking change ships under a
fresh queue prefix (`hmac-v2-<amqpQueue>.queue`) with a major bump to `2.0.0`.

## Transport

- AMQP 0-9-1 via the default exchange `""` (built-in direct).
- One durable queue per peer, `hmac-<amqpQueue>.queue`.
- Routing key = target queue name. Targeting is per message.
- Body content type `application/json`, UTF-8 encoded.
- Persistent delivery.

## Encoding

JSON. Field order is not significant.

### Apply event

Emitted by the source during `sync()` for each pending target.

```jsonc
{
  "eventId": "uuid v4 string",                       // generated per (sync, target)
  "ts": 1781000123456,                               // ms epoch, monotonic per (track, clientId) on the wire
  "propagationSecret": "<secret of the target>",    // shared password, looked up from Table 2
  "senderAmqpQueue": "x-authority-hmac",             // own amqpQueue of the source
  "op": "credential.create" | "credential.update" | "credential.delete",
  "track": "http" | "message",
  "clientId": "client_partner_a",
  "payload": {
    "secretHash": "deadbeef...",                     // empty string for credential.delete
    "allowedIps": ["10.0.0.0/8"],                    // optional
    "expiresAt": null                                // ms epoch or null
  }
}
```

### Ack event

Emitted by the target after applying the inbound apply event locally.

```jsonc
{
  "eventId": "uuid v4 string",                       // fresh, identifies this ack message itself
  "ts": 1781000125000,
  "propagationSecret": "<secret of the source>",    // resolved via management.fetchSourcePropagationSecret
                                                     // or "" if the target is in receive-only mode
  "senderAmqpQueue": "x-ged-extract-mistral",        // own amqpQueue of the target sending the ack
  "op": "credential.ack",
  "ackEventId": "uuid of the original apply event",
  "ackResult": "applied" | "error",
  "ackReason": null                                  // string when ackResult="error"
}
```

## Verification rules

A peer applies the following checks in order. Any failed check aborts processing.

1. JSON parse must succeed.
2. `eventId`, `ts`, `propagationSecret`, `senderAmqpQueue`, `op` must be present and well-typed.
3. `propagationSecret` must match the peer's own env `propagationSecret` via constant-time compare.
   - Mismatch: ack the AMQP message (drop) and log a warning. No requeue.
4. For apply events:
   - Monotonic cursor: `(ts, eventId)` must be strictly greater than the stored cursor for
     `(track, clientId)`. Equality breaks the tie by lexicographic `eventId`.
   - Stale or duplicate: ack and publish a `credential.ack` back with `ackResult="applied"`
     (the source can advance its book-keeping).
   - On apply error: ack the AMQP message and publish `credential.ack` with `ackResult="error"`.
5. For ack events:
   - Look up `ackEventId` in the local ack store. If unknown, drop silently.
   - Otherwise record the result, decrement the pending set, and when empty call
     `markCredentialFullyPropagated` with the aggregated `finalStatus`.

## Compatibility

Wire compatibility is independent of library implementation. A peer running another
language can interoperate with this lib if it honors the JSON shapes, the queue
naming convention, the vhost default, and the constant-time secret check.

| `@naskot/node-hmac-auth-core` (peer dep) | `@naskot/node-hmac-auth-core-propagation` | Notes                                                     |
| ---------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `^1.0.0`                                 | `^1.0.0`                                  | Wire contract pinned `v1`. Latest released: core `1.0.0`. |
