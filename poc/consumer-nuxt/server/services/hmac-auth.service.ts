import { createClient } from "redis";
import { initializeHmacHttpAuth, initializeHmacMessageAuth } from "@naskot/node-hmac-auth-core";

interface HmacAuthService {
  redis: ReturnType<typeof createClient>;
  http: ReturnType<typeof initializeHmacHttpAuth>;
  message: ReturnType<typeof initializeHmacMessageAuth>;
}

let state: HmacAuthService | null = null;
let pending: Promise<HmacAuthService> | null = null;

// Singleton accessor: every server route / plugin asks for the same instance.
export async function getHmacAuthService() {
  if (state) return state;
  if (pending) return pending;
  pending = build();
  state = await pending;
  pending = null;
  return state;
}

async function build(): Promise<HmacAuthService> {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();

  // Two tracks on disjoint sub-trees: keys land under `hmac:http:*` and
  // `hmac:message:*`. `:` is the canonical Redis separator so GUIs render
  // them as a clean tree `hmac > http | message > ...`.
  const http = initializeHmacHttpAuth({
    redis: redis as never,
    namespace: "hmac:http",
    secretToken: process.env.HMAC_SECRET_TOKEN,
  });

  const message = initializeHmacMessageAuth({
    redis: redis as never,
    namespace: "hmac:message",
    secretToken: process.env.HMAC_SECRET_TOKEN,
  });

  console.info("[nuxt-peer] hmac-auth ready, namespaces=hmac:http + hmac:message");
  return { redis, http, message };
}
