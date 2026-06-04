# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning.

## [1.0.0] - 2026-06-04

- `createPropagator(options)` factory returning a `Propagator` with `close`, `ensure`, `rotate`, `revoke`, `sync`.
- Full mode (8-callback `management` adapter) and receive-only mode.
- AMQP transport via `amqplib`: default exchange `""`, vhost `hmac-credentials`, durable queue `hmac-<amqpQueue>.queue` per peer, prefetch 1, publisher confirms.
- Redis monotonic cursor per `(track, clientId)`.
- Redis ack store per `eventId` + per-client pending set + per-client results hash, TTL 7 days.
- `HmacPropagationError` with 4 codes (`MANAGEMENT_NOT_CONFIGURED`, `UNKNOWN_CLIENT`, `INVALID_OPTIONS`, `INTERNAL_ERROR`).
- Wire contract v1: `ApplyEvent` + `AckEvent` JSON shapes pinned for the 1.x line.
- TypeScript types exported: `PropagatorOptions`, `Propagator`, `PropagatorManagement`, `PendingPropagation`, `EnsureInput`, `RotateInputUsage`, `RevokeInput`, `SyncSummary`, callback inputs, `PropagationRedisClient`.
- Docs: `architecture.md`, `wire-contract.md`, `sql-schema.md`, `entities-nestjs.md`, framework guides (NestJS, Express, Nuxt, Next.js), 4 PlantUML diagrams.
- POC `poc/`: management-nest + consumer-nest + consumer-nuxt + consumer-next, 1 RabbitMQ + 1 MariaDB (3 schemas) + 4 Redis.
- `.github/workflows/publish.yml` (semver-tag triggered npm publish with provenance).
- Compatible with `@naskot/node-hmac-auth-core` `^1.0.0`. Wire contract pinned `v1`. Latest released: core `1.0.0`.
