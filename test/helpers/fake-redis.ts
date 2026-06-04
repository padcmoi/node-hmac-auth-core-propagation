import type { PropagationRedisClient } from "../../src/types.js";

// In-memory PropagationRedisClient with the subset of commands the lib uses.
// Mirrors node-redis v4+ camelCase behaviors closely enough for unit tests.
export function makeFakeRedis(): PropagationRedisClient {
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();

  function getHash(key: string) {
    let h = hashes.get(key);
    if (!h) {
      h = new Map();
      hashes.set(key, h);
    }
    return h;
  }

  function getSet(key: string) {
    let s = sets.get(key);
    if (!s) {
      s = new Set();
      sets.set(key, s);
    }
    return s;
  }

  return {
    hGet: async (key, field) => {
      const h = hashes.get(key);
      return h?.get(field) ?? null;
    },
    hSet: async (key, fields) => {
      const h = getHash(key);
      for (const [k, v] of Object.entries(fields)) {
        h.set(k, v);
      }
      return Object.keys(fields).length;
    },
    hGetAll: async (key) => {
      const h = hashes.get(key);
      if (!h) return {};
      return Object.fromEntries(h);
    },
    hDel: async (key, field) => {
      const h = hashes.get(key);
      if (!h) return 0;
      const fields = Array.isArray(field) ? field : [field];
      let n = 0;
      for (const f of fields) {
        if (h.delete(f)) n += 1;
      }
      return n;
    },
    sAdd: async (key, member) => {
      const s = getSet(key);
      const members = Array.isArray(member) ? member : [member];
      let added = 0;
      for (const m of members) {
        if (!s.has(m)) {
          s.add(m);
          added += 1;
        }
      }
      return added;
    },
    sRem: async (key, member) => {
      const s = sets.get(key);
      if (!s) return 0;
      const members = Array.isArray(member) ? member : [member];
      let removed = 0;
      for (const m of members) {
        if (s.delete(m)) removed += 1;
      }
      return removed;
    },
    sCard: async (key) => sets.get(key)?.size ?? 0,
    expire: async () => 1,
    del: async (key) => {
      const keys = Array.isArray(key) ? key : [key];
      let n = 0;
      for (const k of keys) {
        if (hashes.delete(k)) n += 1;
        if (sets.delete(k)) n += 1;
      }
      return n;
    },
  };
}
