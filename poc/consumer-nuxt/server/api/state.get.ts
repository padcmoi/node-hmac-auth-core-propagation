import { getHmacPropagatorService } from "../services/hmac-propagator.service";

export default defineEventHandler(async () => {
  const { pool } = await getHmacPropagatorService();
  const [credentials] = await pool.query(`SELECT * FROM hmac_credential`);
  const [targets] = await pool.query(`SELECT * FROM hmac_propagation_target`);
  const [pivots] = await pool.query(`SELECT * FROM hmac_credential_target`);
  return { peer: process.env.AMQP_QUEUE, credentials, targets, pivots };
});
