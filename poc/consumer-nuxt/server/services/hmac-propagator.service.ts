import mysql from "mysql2/promise";
import { createPropagator, type PendingPropagation, type PropagationRedisClient } from "@naskot/node-hmac-auth-core-propagation";
import { getHmacAuthService } from "./hmac-auth.service";

interface HmacPropagatorService {
  pool: mysql.Pool;
  propagator: Awaited<ReturnType<typeof createPropagator>>;
}

let state: HmacPropagatorService | null = null;
let pending: Promise<HmacPropagatorService> | null = null;

export async function getHmacPropagatorService() {
  if (state) return state;
  if (pending) return pending;
  pending = build();
  state = await pending;
  pending = null;
  return state;
}

async function build(): Promise<HmacPropagatorService> {
  const auth = await getHmacAuthService();

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5,
  });

  const propagator = await createPropagator({
    amqpHost: process.env.AMQP_HOST!,
    amqpPort: Number(process.env.AMQP_PORT ?? 5672),
    amqpUser: process.env.AMQP_USER!,
    amqpPassword: process.env.AMQP_PASSWORD!,
    amqpProtocol: (process.env.AMQP_PROTOCOL as "amqp" | "amqps") ?? "amqp",
    amqpQueue: process.env.AMQP_QUEUE!,
    propagationSecret: process.env.PROPAGATION_SECRET!,
    redis: auth.redis as unknown as PropagationRedisClient,
    hmacHttpAuth: auth.http,
    hmacMessageAuth: auth.message,
    management: {
      upsertCredentialWithTargets: async (input) => {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.query(
            `INSERT INTO hmac_credential (client_id, track, secret_plain, allowed_ips, expires_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE secret_plain=VALUES(secret_plain), allowed_ips=VALUES(allowed_ips), expires_at=VALUES(expires_at)`,
            [
              input.clientId,
              input.track,
              input.secretPlain,
              input.allowedIps ? JSON.stringify(input.allowedIps) : null,
              input.expiresAt != null ? new Date(input.expiresAt) : null,
            ]
          );
          for (const t of input.targets) {
            await conn.query(
              `INSERT INTO hmac_credential_target (client_id, target_amqp_queue, status, attempt_count, reason, sent_at, applied_at, failed_at)
               VALUES (?, ?, 'pending', 0, NULL, NULL, NULL, NULL)
               ON DUPLICATE KEY UPDATE status='pending', attempt_count=0, reason=NULL, sent_at=NULL, applied_at=NULL, failed_at=NULL`,
              [input.clientId, t]
            );
          }
          await conn.commit();
        } catch (err) {
          await conn.rollback();
          throw err;
        } finally {
          conn.release();
        }
      },
      rotateCredentialSecret: async (input) => {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.query(`UPDATE hmac_credential SET secret_plain = ? WHERE client_id = ?`, [
            input.secretPlain,
            input.clientId,
          ]);
          await conn.query(
            `UPDATE hmac_credential_target SET status='pending', attempt_count=0, reason=NULL, sent_at=NULL, applied_at=NULL, failed_at=NULL WHERE client_id = ?`,
            [input.clientId]
          );
          await conn.commit();
        } catch (err) {
          await conn.rollback();
          throw err;
        } finally {
          conn.release();
        }
      },
      fetchPendingPropagations: async () => {
        const [rows] = (await pool.query(
          `SELECT c.client_id, c.track, c.secret_plain, c.allowed_ips, c.expires_at, c.created_at, c.updated_at,
                  ct.target_amqp_queue, t.propagation_secret
             FROM hmac_credential c
             INNER JOIN hmac_credential_target ct ON ct.client_id = c.client_id AND ct.status IN ('pending', 'sent')
             INNER JOIN hmac_propagation_target t ON t.target_amqp_queue = ct.target_amqp_queue`
        )) as [Array<Record<string, unknown>>, unknown];
        const byClient = new Map<string, PendingPropagation>();
        for (const row of rows) {
          const clientId = row.client_id as string;
          let entry = byClient.get(clientId);
          if (!entry) {
            const createdAt = row.created_at as Date;
            const updatedAt = row.updated_at as Date;
            const secretPlain = row.secret_plain as string | null;
            entry = {
              clientId,
              track: row.track as "http" | "message",
              op:
                secretPlain == null
                  ? "credential.delete"
                  : createdAt.getTime() === updatedAt.getTime()
                    ? "credential.create"
                    : "credential.update",
              secretPlain,
              allowedIps: row.allowed_ips ? (JSON.parse(row.allowed_ips as string) as string[]) : undefined,
              expiresAt: row.expires_at ? (row.expires_at as Date).getTime() : null,
              pendingTargets: [],
            };
            byClient.set(clientId, entry);
          }
          entry.pendingTargets.push({
            targetAmqpQueue: row.target_amqp_queue as string,
            propagationSecret: row.propagation_secret as string,
          });
        }
        return Array.from(byClient.values());
      },
      fetchSourcePropagationSecret: async (senderAmqpQueue) => {
        const [rows] = (await pool.query(`SELECT propagation_secret FROM hmac_propagation_target WHERE target_amqp_queue = ?`, [
          senderAmqpQueue,
        ])) as [Array<{ propagation_secret: string }>, unknown];
        return rows[0]?.propagation_secret ?? null;
      },
      markTargetSent: async ({ clientId, targetAmqpQueue, sentAt, attemptCount }) => {
        await pool.query(
          `UPDATE hmac_credential_target SET status='sent', sent_at=?, attempt_count=? WHERE client_id=? AND target_amqp_queue=?`,
          [new Date(sentAt), attemptCount, clientId, targetAmqpQueue]
        );
      },
      markTargetSuccess: async ({ clientId, targetAmqpQueue, appliedAt }) => {
        await pool.query(
          `UPDATE hmac_credential_target SET status='success', applied_at=?, reason=NULL, failed_at=NULL WHERE client_id=? AND target_amqp_queue=?`,
          [new Date(appliedAt), clientId, targetAmqpQueue]
        );
      },
      markTargetError: async ({ clientId, targetAmqpQueue, reason, failedAt }) => {
        await pool.query(
          `UPDATE hmac_credential_target SET status='error', reason=?, failed_at=? WHERE client_id=? AND target_amqp_queue=?`,
          [reason, new Date(failedAt), clientId, targetAmqpQueue]
        );
      },
      markCredentialFullyPropagated: async ({ clientId }) => {
        await pool.query(`UPDATE hmac_credential SET secret_plain = NULL WHERE client_id = ?`, [clientId]);
      },
    },
    logger: { info: console.info, warn: console.warn, error: console.error },
  });

  console.info(`[nuxt-peer] propagator ready as ${process.env.AMQP_QUEUE}`);
  return { pool, propagator };
}
