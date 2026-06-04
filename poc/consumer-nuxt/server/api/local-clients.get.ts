import { getHmacAuthService } from "../services/hmac-auth.service";

// Reads `hmac:http:clients` from this peer's own Redis and returns the list of clientIds
// currently provisioned on the HTTP track, along with their stored secretHash
// (used by /api/call-target to sign outbound requests via `secretIsHashed: true`).
export default defineEventHandler(async () => {
  const { redis } = await getHmacAuthService();
  const all = (await redis.hGetAll("hmac:http:clients")) as Record<string, string>;
  return Object.entries(all).map(([clientId, raw]) => {
    const rec = JSON.parse(raw) as { secretHash: string; createdAt?: number; updatedAt?: number };
    return { clientId, secretHash: rec.secretHash, createdAt: rec.createdAt, updatedAt: rec.updatedAt };
  });
});
