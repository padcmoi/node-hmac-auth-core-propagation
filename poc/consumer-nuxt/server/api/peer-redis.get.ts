import { createClient } from "redis";

const PEER_REDIS_URLS = (process.env.PEER_REDIS_URLS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export default defineEventHandler(async () => {
  const out: Record<string, Array<Record<string, string>>> = {};
  await Promise.all(
    PEER_REDIS_URLS.map(async (url) => {
      const c = createClient({ url });
      try {
        await c.connect();
        const keys = await c.keys("hmac:*");
        const records: Array<Record<string, string>> = [];
        for (const k of keys) {
          const r = await c.hGetAll(k);
          records.push({ key: k, ...r });
        }
        out[url] = records;
      } catch (err) {
        out[url] = [{ key: "ERROR", value: (err as Error).message }];
      } finally {
        await c.disconnect().catch(() => {});
      }
    })
  );
  return out;
});
