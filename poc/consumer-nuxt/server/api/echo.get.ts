import { getHmacAuthService } from "../services/hmac-auth.service";

// HMAC-verified business route. Returns { ok, peer, clientId } when the signature
// matches the credential currently stored in this peer's Redis.
export default defineEventHandler(async (event) => {
  const { http } = await getHmacAuthService();
  try {
    const verified = await http.verifyHttpSignature({
      method: event.method,
      path: event.path,
      headers: getHeaders(event) as Record<string, string | string[] | undefined>,
      rawBody: "",
    });
    return { ok: true, peer: process.env.AMQP_QUEUE, clientId: verified.clientId };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "UNAUTHORIZED";
    const status = (err as { status?: number }).status ?? 401;
    setResponseStatus(event, status);
    return { error: code, message: (err as Error).message };
  }
});
