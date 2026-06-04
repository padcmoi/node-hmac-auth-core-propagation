import { NextResponse } from "next/server";
import { getHmacPropagatorService } from "@/lib/services/hmac-propagator.service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { clientId: string; targets: string[] };
  const { propagator } = await getHmacPropagatorService();
  const result = await propagator.revoke({ clientId: body.clientId, targets: body.targets });
  const sync = await propagator.sync();
  return NextResponse.json({ ...result, sync });
}
