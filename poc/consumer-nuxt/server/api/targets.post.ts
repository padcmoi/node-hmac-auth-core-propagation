import { getHmacPropagatorService } from "../services/hmac-propagator.service";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ targetAmqpQueue: string; propagationSecret: string; note?: string }>(event);
  if (!body?.targetAmqpQueue || !body?.propagationSecret) {
    throw createError({ statusCode: 400, statusMessage: "targetAmqpQueue and propagationSecret are required" });
  }
  const { pool } = await getHmacPropagatorService();
  const [existing] = (await pool.query("SELECT 1 FROM hmac_propagation_target WHERE target_amqp_queue = ?", [
    body.targetAmqpQueue,
  ])) as [Array<unknown>, unknown];
  const op = existing.length > 0 ? "target.update" : "target.create";
  await pool.query(
    `INSERT INTO hmac_propagation_target (target_amqp_queue, propagation_secret, note)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE propagation_secret = VALUES(propagation_secret), note = VALUES(note)`,
    [body.targetAmqpQueue, body.propagationSecret, body.note ?? null]
  );
  return { op, targetAmqpQueue: body.targetAmqpQueue };
});
