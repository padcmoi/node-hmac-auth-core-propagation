import { getHmacAuthService } from "../services/hmac-auth.service";

// Fires an HMAC-signed GET against another peer using the local hashed secret
// (bypasses the need for the plain). Returns the peer's status + body verbatim.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ target: string; clientId: string }>(event);
  const { redis, http } = await getHmacAuthService();

  const raw = (await redis.hGet("hmac:http:clients", body.clientId)) as string | null;
  if (!raw) {
    setResponseStatus(event, 404);
    return { error: "UNKNOWN_CLIENT", message: `clientId ${body.clientId} is not provisioned locally` };
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
    return { status: res.status, body: text };
  } catch (err) {
    setResponseStatus(event, 502);
    return { status: 502, body: (err as Error).message };
  }
});
