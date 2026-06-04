import { NextResponse } from "next/server";
import { getHmacPropagatorService } from "@/lib/services/hmac-propagator.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const { pool } = await getHmacPropagatorService();
  const [credentials] = await pool.query(`SELECT * FROM hmac_credential`);
  const [targets] = await pool.query(`SELECT * FROM hmac_propagation_target`);
  const [pivots] = await pool.query(`SELECT * FROM hmac_credential_target`);
  return NextResponse.json({ peer: process.env.AMQP_QUEUE, credentials, targets, pivots });
}
