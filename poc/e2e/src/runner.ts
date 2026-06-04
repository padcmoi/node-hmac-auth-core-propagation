import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "redis";

const PEERS = {
  mgmt: "http://management-nest:3001",
  cnest: "http://consumer-nest:3002",
  nuxt: "http://consumer-nuxt:3003",
  next: "http://consumer-next:3004",
} as const;

const REDIS_URLS = {
  mgmt: "redis://redis-mgmt:6379",
  cnest: "redis://redis-c-nest:6379",
  nuxt: "redis://redis-nuxt:6379",
  next: "redis://redis-next:6379",
} as const;

const RABBIT_MGMT = "http://rabbitmq:15672";
const RABBIT_VHOST = "hmac-credentials";

interface TestResult {
  name: string;
  ok: boolean;
  ms: number;
  reason?: string;
}

const results: TestResult[] = [];

function color(code: number, s: string) {
  return `\x1b[${code}m${s}\x1b[0m`;
}
const green = (s: string) => color(32, s);
const red = (s: string) => color(31, s);
const yellow = (s: string) => color(33, s);
const dim = (s: string) => color(2, s);

async function step(name: string, fn: () => Promise<void>) {
  const startedAt = Date.now();
  process.stdout.write(`${dim("▸")} ${name} ${dim("...")} `);
  try {
    await fn();
    const ms = Date.now() - startedAt;
    results.push({ name, ok: true, ms });
    console.log(green(`OK ${ms}ms`));
  } catch (err) {
    const ms = Date.now() - startedAt;
    const reason = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, ms, reason });
    console.log(red(`FAIL ${ms}ms`));
    console.log(red(`  ${reason}`));
  }
}

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond: unknown, label: string) {
  if (!cond) throw new Error(label);
}
function assertNotEq<T>(actual: T, forbidden: T, label: string) {
  if (actual === forbidden) {
    throw new Error(`${label}: expected NOT to be ${JSON.stringify(forbidden)}`);
  }
}

interface JsonBody {
  [k: string]: unknown;
}

async function http(method: string, url: string, body?: JsonBody) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function rabbitQueueDepth(queueName: string) {
  const res = await fetch(`${RABBIT_MGMT}/api/queues/${encodeURIComponent(RABBIT_VHOST)}/${queueName}`, {
    headers: { authorization: `Basic ${Buffer.from("guest:guest").toString("base64")}` },
  });
  if (!res.ok) throw new Error(`rabbit /api/queues/${queueName} → ${res.status}`);
  const json = (await res.json()) as {
    messages?: number;
    messages_ready?: number;
    messages_unacknowledged?: number;
    consumers?: number;
  };
  return {
    messages: json.messages ?? 0,
    ready: json.messages_ready ?? 0,
    unacked: json.messages_unacknowledged ?? 0,
    consumers: json.consumers ?? 0,
  };
}

async function waitForHttp(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok || r.status === 404) return;
    } catch {
      // ignore, retry
    }
    await sleep(500);
  }
  throw new Error(`${url} not ready in ${timeoutMs}ms`);
}

async function getHash(redisUrl: string, clientId: string): Promise<string | null> {
  const c = createClient({ url: redisUrl });
  await c.connect();
  try {
    const raw = await c.hGet("hmac:http:clients", clientId);
    if (!raw) return null;
    const rec = JSON.parse(raw) as { secretHash?: string };
    return rec.secretHash ?? null;
  } finally {
    await c.disconnect();
  }
}

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 15_000, pollMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v !== null) return v;
    } catch {
      // ignore, retry
    }
    await sleep(pollMs);
  }
  throw new Error(`timeout after ${timeoutMs}ms waiting for ${label}`);
}

function uniqueId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function dockerExec(cmd: string) {
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function main() {
  console.log(yellow("\nhmac-propagation POC — end-to-end harness\n"));

  let clientA = "";
  let clientB = "";
  let clientLocal = "";

  // ─── Stack readiness ───────────────────────────────────────────────────────
  // `depends_on: service_started` in compose only confirms the container is up,
  // not that the Node app inside is already accepting connections. So we block
  // until every peer answers HTTP before running any other test.
  await step("S01 wait until the 4 peers accept HTTP", async () => {
    await Promise.all([
      waitForHttp(`${PEERS.mgmt}/admin/state`),
      waitForHttp(`${PEERS.cnest}/`),
      waitForHttp(`${PEERS.nuxt}/`),
      waitForHttp(`${PEERS.next}/`),
    ]);
  });

  // ─── Full pipeline against mgmt-nest ─────────────────────────────────────
  await step("S02 ensure e2e_a from mgmt → 3 targets, same hash on 4 redises", async () => {
    clientA = uniqueId("e2e_a");
    const res = await http("POST", `${PEERS.mgmt}/admin/ensure`, {
      clientId: clientA,
      secret: "plain-A",
      targets: ["c-nest", "nuxt", "next"],
    });
    assertEq(res.status, 201, "POST /admin/ensure");
    // Wait for the hash to land on every peer (1 publish per target + apply + cursor).
    const expected = await waitFor(`hash present on mgmt for ${clientA}`, () => getHash(REDIS_URLS.mgmt, clientA));
    for (const [name, url] of Object.entries(REDIS_URLS)) {
      const h = await waitFor(`hash on ${name}`, () => getHash(url, clientA));
      assertEq(h, expected, `hash on ${name} matches mgmt`);
    }
  });

  await step("S03 signed call mgmt → c-nest with e2e_a returns 200 + clientId", async () => {
    const res = await http("POST", `${PEERS.mgmt}/admin/call-target`, {
      target: `${PEERS.cnest}/api/echo`,
      clientId: clientA,
      secret: "plain-A",
    });
    assertEq(res.status, 201, "POST /admin/call-target");
    const body = res.body as { status?: number; body?: string };
    assertEq(body.status, 200, "downstream status");
    const inner = JSON.parse(body.body ?? "{}") as { clientId?: string };
    assertEq(inner.clientId, clientA, "echoed clientId");
  });

  await step("S04 signed call with WRONG secret → 401 BAD_SIGNATURE", async () => {
    const res = await http("POST", `${PEERS.mgmt}/admin/call-target`, {
      target: `${PEERS.cnest}/api/echo`,
      clientId: clientA,
      secret: "wrong-plain",
    });
    const body = res.body as { status?: number; body?: string };
    assertEq(body.status, 401, "downstream status");
    assertTrue(/BAD_SIGNATURE/.test(body.body ?? ""), "body contains BAD_SIGNATURE");
  });

  await step("S05 rotate e2e_a, new hash on 4 redises (and != previous)", async () => {
    const before = await getHash(REDIS_URLS.mgmt, clientA);
    assertTrue(before, "previous hash exists");
    const res = await http("POST", `${PEERS.mgmt}/admin/rotate`, { clientId: clientA, secret: "plain-A-2" });
    assertEq(res.status, 201, "POST /admin/rotate");
    await http("POST", `${PEERS.mgmt}/admin/sync`);
    const expected = await waitFor(`hash rotated on mgmt`, async () => {
      const h = await getHash(REDIS_URLS.mgmt, clientA);
      return h && h !== before ? h : null;
    });
    for (const [name, url] of Object.entries(REDIS_URLS)) {
      const h = await waitFor(`rotated hash on ${name}`, async () => {
        const x = await getHash(url, clientA);
        return x === expected ? x : null;
      });
      assertEq(h, expected, `${name} converged on new hash`);
    }
  });

  await step("S06 signed call with NEW secret OK, OLD secret rejected", async () => {
    const newOk = await http("POST", `${PEERS.mgmt}/admin/call-target`, {
      target: `${PEERS.cnest}/api/echo`,
      clientId: clientA,
      secret: "plain-A-2",
    });
    assertEq((newOk.body as { status?: number }).status, 200, "new secret OK");
    const oldKo = await http("POST", `${PEERS.mgmt}/admin/call-target`, {
      target: `${PEERS.cnest}/api/echo`,
      clientId: clientA,
      secret: "plain-A",
    });
    assertEq((oldKo.body as { status?: number }).status, 401, "old secret rejected");
  });

  await step("S07 revoke e2e_a, clientId absent from every redis", async () => {
    const res = await http("POST", `${PEERS.mgmt}/admin/revoke`, {
      clientId: clientA,
      targets: ["c-nest", "nuxt", "next"],
    });
    assertEq(res.status, 201, "POST /admin/revoke");
    await http("POST", `${PEERS.mgmt}/admin/sync`);
    for (const [name, url] of Object.entries(REDIS_URLS)) {
      await waitFor(`${name} drops ${clientA}`, async () => {
        const h = await getHash(url, clientA);
        return h === null ? true : null;
      });
    }
  });

  // ─── Local-only scope ────────────────────────────────────────────────────
  await step("S08 ensure on next with 0 targets stores ONLY on next's redis", async () => {
    clientLocal = uniqueId("e2e_local");
    const res = await http("POST", `${PEERS.next}/api/ensure`, {
      clientId: clientLocal,
      secret: "plain-L",
      targets: [],
    });
    assertEq(res.status, 200, "POST /api/ensure");
    const local = await waitFor(`hash on next for ${clientLocal}`, () => getHash(REDIS_URLS.next, clientLocal));
    assertTrue(local, "next has the hash");
    for (const peer of ["mgmt", "cnest", "nuxt"] as const) {
      const h = await getHash(REDIS_URLS[peer], clientLocal);
      assertEq(h, null, `${peer} does NOT have ${clientLocal}`);
    }
  });

  await step("S09 cleanup local-only credential via revoke targets=[]", async () => {
    await http("POST", `${PEERS.next}/api/revoke`, { clientId: clientLocal, targets: [] });
    await waitFor(`next drops ${clientLocal}`, async () => {
      const h = await getHash(REDIS_URLS.next, clientLocal);
      return h === null ? true : null;
    });
  });

  // ─── Table 2 dynamic targets ─────────────────────────────────────────────
  await step("S10 add then delete a partner target on mgmt-nest (Table 2)", async () => {
    const queue = uniqueId("partner");
    const add = await http("POST", `${PEERS.mgmt}/admin/targets`, {
      targetAmqpQueue: queue,
      propagationSecret: "secret-of-" + queue,
      note: "e2e demo",
    });
    assertEq(add.status, 201, "POST /admin/targets create");
    assertEq((add.body as { op?: string }).op, "target.create", "op=target.create");
    const del = await http("DELETE", `${PEERS.mgmt}/admin/targets/${queue}`);
    assertEq(del.status, 200, "DELETE /admin/targets/:q");
    assertEq((del.body as { op?: string }).op, "target.delete", "op=target.delete");
  });

  await step("S11 self-target deletion is refused with 400", async () => {
    const res = await http("DELETE", `${PEERS.mgmt}/admin/targets/mgmt-nest`);
    assertEq(res.status, 400, "self deletion forbidden");
  });

  // ─── Env contract ────────────────────────────────────────────────────────
  await step("S12 four peers carry four DISTINCT HMAC_SECRET_TOKEN values", async () => {
    const peppers = new Set<string>();
    for (const c of ["management-nest", "consumer-nest", "consumer-nuxt", "consumer-next"]) {
      const v = dockerExec(`docker exec hmac-poc-${c} sh -c 'echo $HMAC_SECRET_TOKEN'`);
      assertTrue(v.length > 0, `${c} has HMAC_SECRET_TOKEN`);
      peppers.add(v);
    }
    assertEq(peppers.size, 4, "4 distinct peppers");
  });

  // ─── Offline target + publish-once + drain on restart ────────────────────
  let queueBefore = 0;
  await step("S13 stop consumer-nest, ensure clientB targeting c-nest", async () => {
    dockerExec("docker stop hmac-poc-consumer-nest");
    // Wait until RabbitMQ evicts c-nest's TCP-dead consumer (~2 missed heartbeats
    // = ~20s on our 10s heartbeat config) so the next publish lands as `Ready`
    // on a queue with no consumer, not Unacked on a ghost.
    await waitFor(
      "c-nest consumer evicted",
      async () => {
        const d = await rabbitQueueDepth("hmac-c-nest.queue");
        return d.consumers === 0 ? d : null;
      },
      30_000,
      500
    );
    clientB = uniqueId("e2e_b");
    const res = await http("POST", `${PEERS.mgmt}/admin/ensure`, {
      clientId: clientB,
      secret: "plain-B",
      targets: ["c-nest"],
    });
    assertEq(res.status, 201, "POST /admin/ensure");
    await http("POST", `${PEERS.mgmt}/admin/sync`);
    const depth = await waitFor(
      "hmac-c-nest.queue has the published message",
      async () => {
        const d = await rabbitQueueDepth("hmac-c-nest.queue");
        return d.messages >= 1 ? d : null;
      },
      10_000
    );
    queueBefore = depth.messages;
    assertTrue(depth.messages >= 1, `expected ≥1 message, got ${depth.messages}`);
  });

  await step("S14 cron ticks pass: queue stays bounded (publish-once policy)", async () => {
    await sleep(20_000);
    await http("POST", `${PEERS.mgmt}/admin/sync`);
    await sleep(2000);
    const depth = await rabbitQueueDepth("hmac-c-nest.queue");
    // tolerate +/- 1 for cron tick alignment; key check is no runaway growth
    assertTrue(depth.messages <= queueBefore + 1, `queue grew unbounded: before=${queueBefore}, after=${depth.messages}`);
  });

  await step("S15 restart consumer-nest: queue drains and clientB hash appears", async () => {
    dockerExec("docker start hmac-poc-consumer-nest");
    await waitFor(`c-nest hash for ${clientB}`, () => getHash(REDIS_URLS.cnest, clientB), 30_000);
    const drained = await waitFor(`queue empty`, async () => {
      const d = await rabbitQueueDepth("hmac-c-nest.queue");
      return d.messages === 0 ? d : null;
    });
    assertEq(drained.messages, 0, "queue fully drained");
    assertTrue(drained.consumers >= 1, "consumer-nest is subscribed");
  });

  await step("S16 cleanup clientB to leave the stack clean for the next run", async () => {
    await http("POST", `${PEERS.mgmt}/admin/revoke`, { clientId: clientB, targets: ["c-nest"] });
    await http("POST", `${PEERS.mgmt}/admin/sync`);
    await waitFor(`c-nest drops ${clientB}`, async () => {
      const h = await getHash(REDIS_URLS.cnest, clientB);
      return h === null ? true : null;
    });
  });

  // ─── Summary ─────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;
  const totalMs = results.reduce((sum, r) => sum + r.ms, 0);

  console.log("");
  console.log(yellow("─".repeat(70)));
  if (failed === 0) {
    console.log(green(`✓ ${passed}/${total} passed in ${totalMs}ms`));
  } else {
    console.log(red(`✗ ${failed} failed, ${passed}/${total} passed in ${totalMs}ms`));
    for (const r of results.filter((x) => !x.ok)) {
      console.log(red(`  • ${r.name}: ${r.reason}`));
    }
  }
  console.log("");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(red(`fatal: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(2);
});
