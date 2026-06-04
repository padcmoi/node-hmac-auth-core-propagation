# SQL reference schema (MariaDB / MySQL)

**Docs:** [README](../README.md) · [Architecture](./architecture.md) · [Wire contract](./wire-contract.md) · SQL schema · [TypeORM entities](./entities-nestjs.md) · [Express](./express/README.md) · [NestJS](./nestjs/README.md) · [Nuxt](./nuxt/README.md) · [Next.js](./nextjs/README.md) · [Release notes 1.0.0](./release-notes/1.0.0.md) · [CHANGELOG](../CHANGELOG.md) · [POC](../poc/README.md)

---

The lib does not impose a schema. It only requires the `management` callbacks to
honor the TypeScript contracts. The 4-table layout below is the canonical reference
used by the POC and `entities-nestjs.md`.

```sql
-- =========================================================================
-- Table 1: one row per clientId, holds the transient plain while propagation
-- is in flight. NULL'd by the consumer's markCredentialFullyPropagated callback
-- when every target is terminal.
-- =========================================================================
CREATE TABLE hmac_credential (
  client_id     VARCHAR(128) PRIMARY KEY,
  track         ENUM('http','message') NOT NULL,
  secret_plain  TEXT NULL,
  allowed_ips   JSON NULL,
  expires_at    DATETIME(3) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- =========================================================================
-- Table 2: inventory of known targets and their entry secret. Populated
-- out-of-band by the operator (manual provisioning, infra-as-code, internal
-- console). The lib never creates a row here; it only reads via JOIN.
-- propagation_secret = env value of the target peer, shared out-of-band by
-- the target operator via a secure channel (1password, KMS, etc.).
-- Several clientIds may reference the same target row.
-- =========================================================================
CREATE TABLE hmac_propagation_target (
  target_amqp_queue   VARCHAR(128) PRIMARY KEY,
  propagation_secret  TEXT NOT NULL,
  note                TEXT NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- =========================================================================
-- Table 3: pivot clientId x target with per-row status. Composite PK.
-- Both FK are ON DELETE RESTRICT: it is impossible to drop a row from
-- Table 1 or Table 2 while this pivot references it.
-- =========================================================================
CREATE TABLE hmac_credential_target (
  client_id          VARCHAR(128) NOT NULL,
  target_amqp_queue  VARCHAR(128) NOT NULL,
  status             ENUM('pending','sent','success','error') NOT NULL DEFAULT 'pending',
  attempt_count      INT UNSIGNED NOT NULL DEFAULT 0,
  reason             TEXT NULL,
  sent_at            DATETIME(3) NULL,
  applied_at         DATETIME(3) NULL,
  failed_at          DATETIME(3) NULL,
  updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (client_id, target_amqp_queue),
  KEY idx_status (status),
  CONSTRAINT fk_ct_credential
    FOREIGN KEY (client_id) REFERENCES hmac_credential(client_id) ON DELETE RESTRICT,
  CONSTRAINT fk_ct_target
    FOREIGN KEY (target_amqp_queue) REFERENCES hmac_propagation_target(target_amqp_queue) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- =========================================================================
-- Table 4: append-only audit. The lib does not write here; consumers can
-- insert from inside their own markTarget* callbacks if they want a trail.
-- FK ON DELETE RESTRICT on the pivot row to force explicit archival before
-- cleanup of a target.
-- =========================================================================
CREATE TABLE hmac_credential_target_audit (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  client_id          VARCHAR(128) NOT NULL,
  target_amqp_queue  VARCHAR(128) NOT NULL,
  event_type         ENUM('ensure','rotate','revoke','target_sent','target_success','target_error','fully_propagated') NOT NULL,
  status             VARCHAR(32) NULL,
  reason             TEXT NULL,
  at                 DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_client (client_id),
  KEY idx_at (at),
  CONSTRAINT fk_audit_ct
    FOREIGN KEY (client_id, target_amqp_queue)
    REFERENCES hmac_credential_target(client_id, target_amqp_queue) ON DELETE RESTRICT
) ENGINE=InnoDB;
```

## Provisioning Table 2 (out-of-band)

Before peer A can propagate to B, the operator of B shares its env
`propagationSecret` to the operator of A via a secure channel. A records it in
Table 2:

```sql
INSERT INTO hmac_propagation_target (target_amqp_queue, propagation_secret, note) VALUES
  ('x-ged-extract-mistral', '<env-secret-of-ged-extract-mistral>', 'env=prod, owner=team-ged'),
  ('docker-nestjs-template','<env-secret-of-template>',            'env=prod, boilerplate');
```

That is business of the consumer, never touched by the lib.

## FK ON DELETE RESTRICT semantics

- DROP of a Table 1 row: SQL error if Table 3 references it. Forces a clean
  `revoke()` before cleanup.
- DROP of a Table 2 row: SQL error if Table 3 references it. Forces explicit
  detachment of every clientId before retiring a target from the mesh.
- DROP of a Table 3 row: SQL error if Table 4 references it. Forces audit archival
  before cleanup.

No cascade. The operator must know what they delete.

## Cycle of a row under ensure / rotate / revoke / sync

### ensure(clientId, secret, [B, C, D])

```sql
START TRANSACTION;
  INSERT INTO hmac_credential (client_id, track, secret_plain, allowed_ips, expires_at)
    VALUES ('client_partner_a', 'http', '<plain>', '["10.0.0.0/8"]', NULL)
    ON DUPLICATE KEY UPDATE
      secret_plain = VALUES(secret_plain),
      allowed_ips  = VALUES(allowed_ips),
      expires_at   = VALUES(expires_at);

  INSERT INTO hmac_credential_target (client_id, target_amqp_queue, status, attempt_count)
    VALUES
      ('client_partner_a', 'B', 'pending', 0),
      ('client_partner_a', 'C', 'pending', 0),
      ('client_partner_a', 'D', 'pending', 0)
    ON DUPLICATE KEY UPDATE
      status='pending', attempt_count=0,
      reason=NULL, sent_at=NULL, applied_at=NULL, failed_at=NULL;
COMMIT;
```

### rotate(clientId, newSecret)

```sql
START TRANSACTION;
  UPDATE hmac_credential
    SET secret_plain = '<newPlain>'
    WHERE client_id = 'client_partner_a';

  UPDATE hmac_credential_target
    SET status='pending', attempt_count=0,
        reason=NULL, sent_at=NULL, applied_at=NULL, failed_at=NULL
    WHERE client_id = 'client_partner_a';
COMMIT;
```

### revoke(clientId, [B, C, D])

```sql
START TRANSACTION;
  UPDATE hmac_credential SET secret_plain = NULL WHERE client_id = 'client_partner_a';
  INSERT INTO hmac_credential_target (client_id, target_amqp_queue, status)
    VALUES ('client_partner_a','B','pending'),('client_partner_a','C','pending'),('client_partner_a','D','pending')
    ON DUPLICATE KEY UPDATE
      status='pending', attempt_count=0,
      reason=NULL, sent_at=NULL, applied_at=NULL, failed_at=NULL;
COMMIT;
```

### sync() reads pending propagations

```sql
SELECT
  c.client_id, c.track, c.secret_plain, c.allowed_ips, c.expires_at,
  ct.target_amqp_queue, t.propagation_secret
FROM hmac_credential c
INNER JOIN hmac_credential_target ct
  ON ct.client_id = c.client_id AND ct.status IN ('pending', 'sent')
INNER JOIN hmac_propagation_target t
  ON t.target_amqp_queue = ct.target_amqp_queue;
```

The callback groups rows by `client_id`, composes `PendingPropagation[]`, and never
logs the `propagation_secret`.

### markCredentialFullyPropagated NULLs the plain

```sql
UPDATE hmac_credential
  SET secret_plain = NULL
  WHERE client_id = 'client_partner_a';
```

Table 3 holds the terminal statuses, Table 4 holds the audit trail, Table 1 no
longer carries the plain.
