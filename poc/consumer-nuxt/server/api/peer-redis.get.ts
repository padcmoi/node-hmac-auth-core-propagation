import { createClient } from "redis";

const PEER_REDIS_URLS = (process.env.PEER_REDIS_URLS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

type RedisEntry = Record<string, unknown> & { key: string; type: string };

export default defineEventHandler(async () => {
  const results = await Promise.all(
    PEER_REDIS_URLS.map(async (url): Promise<RedisEntry[]> => {
      const c = createClient({ url });
      try {
        await c.connect();
        const keys = await c.keys("hmac:*");
        keys.sort();
        const records: RedisEntry[] = [];
        for (const k of keys) {
          const type = await c.type(k);
          const entry: RedisEntry = { key: k, type };
          // Each Redis type carries a different reader. Globbing `hmac:*` legitimately
          // returns hashes (`hmac:http:clients`), strings (rotation backup, nonces, cursors)
          // and possibly sets/lists/zsets if the core lib grows new structures.
          if (type === "hash") Object.assign(entry, await c.hGetAll(k));
          else if (type === "string") entry.value = await c.get(k);
          else if (type === "set") entry.members = await c.sMembers(k);
          else if (type === "list") entry.items = await c.lRange(k, 0, -1);
          else if (type === "zset") entry.scores = await c.zRangeWithScores(k, 0, -1);
          records.push(entry);
        }
        return records;
      } catch (err) {
        return [{ key: "ERROR", type: "error", value: (err as Error).message }];
      } finally {
        await c.disconnect().catch(() => {});
      }
    })
  );
  // Rebuild the object in the canonical PEER_REDIS_URLS order so the UI is stable
  // regardless of which Redis instance responded first.
  const out: Record<string, RedisEntry[]> = {};
  PEER_REDIS_URLS.forEach((url, i) => {
    out[url] = results[i]!;
  });
  return out;
});
