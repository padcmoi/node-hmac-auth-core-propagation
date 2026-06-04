import { getHmacPropagatorService } from "../../services/hmac-propagator.service";

export default defineEventHandler(async (event) => {
  const queue = getRouterParam(event, "queue");
  if (!queue) {
    throw createError({ statusCode: 400, statusMessage: "queue path param is required" });
  }
  if (queue === process.env.AMQP_QUEUE) {
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot delete the peer's own self-target row (it is used for inbound ACK signing).",
    });
  }
  const { pool } = await getHmacPropagatorService();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM hmac_credential_target WHERE target_amqp_queue = ?", [queue]);
    await conn.query("DELETE FROM hmac_propagation_target WHERE target_amqp_queue = ?", [queue]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { op: "target.delete", targetAmqpQueue: queue };
});
