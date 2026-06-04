import { NextResponse } from "next/server";
import { getHmacPropagatorService } from "@/lib/services/hmac-propagator.service";

export const dynamic = "force-dynamic";

export async function POST() {
  const { propagator } = await getHmacPropagatorService();
  const summary = await propagator.sync();
  return NextResponse.json(summary);
}
