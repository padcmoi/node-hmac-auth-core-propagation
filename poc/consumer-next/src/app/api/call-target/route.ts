import { NextResponse } from "next/server";
import { getHmacAuthService } from "@/lib/services/hmac-auth.service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { target: string; clientId: string };
  const { redis, http } = await getHmacAuthService();

  const raw = (await redis.hGet("hmac:http:clients", body.clientId)) as string | null;
  if (!raw) {
    return NextResponse.json(
      { error: "UNKNOWN_CLIENT", message: `clientId ${body.clientId} is not provisioned locally` },
      { status: 404 }
    );
  }
  const rec = JSON.parse(raw) as { secretHash: string };

  const fetchSigned = http.createHttpSignedFetchClient({
    clientId: body.clientId,
    secret: rec.secretHash,
    secretIsHashed: true,
  });

  try {
    const res = await fetchSigned(body.target, { method: "GET" });
    const text = await res.text();
    return NextResponse.json({ status: res.status, body: text });
  } catch (err) {
    return NextResponse.json({ status: 502, body: (err as Error).message }, { status: 502 });
  }
}
