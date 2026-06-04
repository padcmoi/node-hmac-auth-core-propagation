import { NextResponse } from "next/server";
import { getHmacPropagatorService } from "@/lib/services/hmac-propagator.service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { targetAmqpQueue: string; propagationSecret: string; note?: string };
  if (!body.targetAmqpQueue || !body.propagationSecret) {
    return NextResponse.json({ error: "targetAmqpQueue and propagationSecret are required" }, { status: 400 });
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
  return NextResponse.json({ op, targetAmqpQueue: body.targetAmqpQueue });
}
