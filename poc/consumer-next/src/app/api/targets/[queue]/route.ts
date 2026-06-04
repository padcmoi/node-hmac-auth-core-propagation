import { NextResponse } from "next/server";
import { getHmacPropagatorService } from "@/lib/services/hmac-propagator.service";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ queue: string }> }) {
  const { queue } = await ctx.params;
  if (!queue) {
    return NextResponse.json({ error: "queue path param is required" }, { status: 400 });
  }
  if (queue === process.env.AMQP_QUEUE) {
    return NextResponse.json(
      { error: "Cannot delete the peer's own self-target row (it is used for inbound ACK signing)." },
      { status: 400 }
    );
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
  return NextResponse.json({ op: "target.delete", targetAmqpQueue: queue });
}
