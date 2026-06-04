import { NextResponse } from "next/server";
import { getHmacAuthService } from "@/lib/services/hmac-auth.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const { redis } = await getHmacAuthService();
  const all = (await redis.hGetAll("hmac:http:clients")) as Record<string, string>;
  const rows = Object.entries(all).map(([clientId, raw]) => {
    const rec = JSON.parse(raw) as { secretHash: string; createdAt?: number; updatedAt?: number };
    return { clientId, secretHash: rec.secretHash, createdAt: rec.createdAt, updatedAt: rec.updatedAt };
  });
  return NextResponse.json(rows);
}
