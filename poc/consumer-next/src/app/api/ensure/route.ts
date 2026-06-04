import { NextResponse } from "next/server";
import { getHmacPropagatorService } from "@/lib/services/hmac-propagator.service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { clientId: string; secret: string; targets: string[] };
  const { propagator } = await getHmacPropagatorService();
  const result = await propagator.ensure({ clientId: body.clientId, secret: body.secret, targets: body.targets });
  // Auto-sync so each action produces its own AMQP message.
  const sync = await propagator.sync();
  return NextResponse.json({ ...result, sync });
}
