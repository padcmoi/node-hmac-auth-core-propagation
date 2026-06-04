import { NextResponse } from "next/server";
import { getHmacAuthService } from "@/lib/services/hmac-auth.service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { http } = await getHmacAuthService();
  try {
    const verified = await http.verifyHttpSignature({
      method: "GET",
      path: new URL(req.url).pathname,
      headers: Object.fromEntries(req.headers),
      rawBody: "",
    });
    return NextResponse.json({ ok: true, peer: process.env.AMQP_QUEUE, clientId: verified.clientId });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "UNAUTHORIZED";
    const status = (err as { status?: number }).status ?? 401;
    return NextResponse.json({ error: code, message: (err as Error).message }, { status });
  }
}
