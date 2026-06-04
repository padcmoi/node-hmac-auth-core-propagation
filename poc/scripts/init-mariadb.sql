-- One MariaDB instance, three schemas: nest_db (NestJS authority), nuxt_db (Nuxt v4), next_db (Next.js 15).
-- Each schema carries the 4 reference tables. Table 2 is seeded with the propagation secrets of the
-- other peers in the mesh so each authority can sign outbound events to them.

CREATE DATABASE IF NOT EXISTS nest_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS nuxt_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS next_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Schema applied to all three: 4 tables with FK ON DELETE RESTRICT everywhere.

DELIMITER //
CREATE PROCEDURE apply_schema(IN dbname VARCHAR(64))
BEGIN
  SET @s = CONCAT('CREATE TABLE IF NOT EXISTS ', dbname, '.hmac_credential (
      client_id     VARCHAR(128) PRIMARY KEY,
      track         ENUM("http","message") NOT NULL,
      secret_plain  TEXT NULL,
      allowed_ips   JSON NULL,
      expires_at    DATETIME(3) NULL,
      created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB');
  PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

  SET @s = CONCAT('CREATE TABLE IF NOT EXISTS ', dbname, '.hmac_propagation_target (
      target_amqp_queue   VARCHAR(128) PRIMARY KEY,
      propagation_secret  TEXT NOT NULL,
      note                TEXT NULL,
      created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB');
  PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

  SET @s = CONCAT('CREATE TABLE IF NOT EXISTS ', dbname, '.hmac_credential_target (
      client_id          VARCHAR(128) NOT NULL,
      target_amqp_queue  VARCHAR(128) NOT NULL,
      status             ENUM("pending","sent","success","error") NOT NULL DEFAULT "pending",
      attempt_count      INT UNSIGNED NOT NULL DEFAULT 0,
      reason             TEXT NULL,
      sent_at            DATETIME(3) NULL,
      applied_at         DATETIME(3) NULL,
      failed_at          DATETIME(3) NULL,
      updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (client_id, target_amqp_queue),
      KEY idx_status (status),
      CONSTRAINT fk_ct_credential_', dbname, '
        FOREIGN KEY (client_id) REFERENCES ', dbname, '.hmac_credential(client_id) ON DELETE RESTRICT,
      CONSTRAINT fk_ct_target_', dbname, '
        FOREIGN KEY (target_amqp_queue) REFERENCES ', dbname, '.hmac_propagation_target(target_amqp_queue) ON DELETE RESTRICT
    ) ENGINE=InnoDB');
  PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

  SET @s = CONCAT('CREATE TABLE IF NOT EXISTS ', dbname, '.hmac_credential_target_audit (
      id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
      client_id          VARCHAR(128) NOT NULL,
      target_amqp_queue  VARCHAR(128) NOT NULL,
      event_type         ENUM("ensure","rotate","revoke","target_sent","target_success","target_error","fully_propagated") NOT NULL,
      status             VARCHAR(32) NULL,
      reason             TEXT NULL,
      at                 DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_client (client_id),
      KEY idx_at (at)
    ) ENGINE=InnoDB');
  PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
END//
DELIMITER ;

CALL apply_schema('nest_db');
CALL apply_schema('nuxt_db');
CALL apply_schema('next_db');

DROP PROCEDURE apply_schema;

-- Seed Table 2 for each authority. Each row carries the env propagationSecret of a peer.
-- nest_db sees c-nest, nuxt, next as targets.
INSERT INTO nest_db.hmac_propagation_target (target_amqp_queue, propagation_secret, note) VALUES
  ('c-nest',    'secret-of-c-nest',    'NestJS receive-only consumer'),
  ('nuxt',      'secret-of-nuxt',      'Nuxt v4 full mode peer'),
  ('next',      'secret-of-next',      'Next.js 15 full mode peer'),
  ('mgmt-nest', 'secret-of-mgmt-nest', 'self entry for inbound ack signing');

-- nuxt_db sees mgmt-nest, c-nest, next.
INSERT INTO nuxt_db.hmac_propagation_target (target_amqp_queue, propagation_secret, note) VALUES
  ('mgmt-nest', 'secret-of-mgmt-nest', 'NestJS authority'),
  ('c-nest',    'secret-of-c-nest',    'NestJS receive-only consumer'),
  ('next',      'secret-of-next',      'Next.js 15 full mode peer'),
  ('nuxt',      'secret-of-nuxt',      'self entry for inbound ack signing');

-- next_db sees mgmt-nest, c-nest, nuxt.
INSERT INTO next_db.hmac_propagation_target (target_amqp_queue, propagation_secret, note) VALUES
  ('mgmt-nest', 'secret-of-mgmt-nest', 'NestJS authority'),
  ('c-nest',    'secret-of-c-nest',    'NestJS receive-only consumer'),
  ('nuxt',      'secret-of-nuxt',      'Nuxt v4 full mode peer'),
  ('next',      'secret-of-next',      'self entry for inbound ack signing');
