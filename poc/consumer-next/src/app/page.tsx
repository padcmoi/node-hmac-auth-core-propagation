"use client";

import { useEffect, useState } from "react";

const SELF = "next";
const ALL_PEERS = ["mgmt-nest", "c-nest", "nuxt", "next"] as const;
const PEER_URLS: Record<string, string> = {
  "mgmt-nest": "http://management-nest:3001/api/echo",
  "c-nest": "http://consumer-nest:3002/api/echo",
  nuxt: "http://consumer-nuxt:3003/api/echo",
  next: "http://consumer-next:3004/api/echo",
};

const OTHER_PEERS = ALL_PEERS.filter((p) => p !== SELF);

interface LocalClient {
  clientId: string;
  secretHash: string;
  createdAt?: number;
  updatedAt?: number;
}

interface AnyMap {
  [k: string]: unknown;
}

export default function Page() {
  const [dbState, setDbState] = useState<AnyMap | null>(null);
  const [peerRedis, setPeerRedis] = useState<AnyMap | null>(null);
  const [localClients, setLocalClients] = useState<LocalClient[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [callResult, setCallResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const [op, setOp] = useState<"ensure" | "rotate" | "revoke">("ensure");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [targets, setTargets] = useState<string[]>([]);

  const [callClientId, setCallClientId] = useState("");
  const [callTarget, setCallTarget] = useState<string>(OTHER_PEERS[0]);

  async function refreshAll() {
    const [a, b, c] = await Promise.all([
      fetch("/api/state").then((r) => r.json()),
      fetch("/api/peer-redis").then((r) => r.json()),
      fetch("/api/local-clients").then((r) => r.json()),
    ]);
    setDbState(a);
    setPeerRedis(b);
    setLocalClients(c);
  }

  useEffect(() => {
    refreshAll();
  }, []);

  function toggleTarget(p: string) {
    setTargets((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  async function submitOp() {
    setBusy(true);
    try {
      let url: string;
      let body: Record<string, unknown>;
      if (op === "ensure") {
        url = "/api/ensure";
        body = { clientId, secret, targets };
      } else if (op === "rotate") {
        url = "/api/rotate";
        body = { clientId, secret };
      } else {
        url = "/api/revoke";
        body = { clientId, targets };
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setResult(await res.json());
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function callOther() {
    setBusy(true);
    try {
      const res = await fetch("/api/call-target", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: PEER_URLS[callTarget], clientId: callClientId }),
      });
      setCallResult(await res.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">hmac-propagation POC peer (Next.js 15)</h1>
          <p className="text-sm text-slate-600">
            Full mode. Drives <code className="rounded bg-slate-200 px-1">propagator.ensure / rotate / revoke</code> against its
            own MariaDB schema <code className="rounded bg-slate-200 px-1">next_db</code>. Each action auto-syncs so its event is
            published immediately.
          </p>
        </header>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Drive propagation</h2>
          <div className="mb-3 flex gap-4">
            {(["ensure", "rotate", "revoke"] as const).map((o) => (
              <label key={o} className="flex items-center gap-1">
                <input type="radio" checked={op === o} onChange={() => setOp(o)} />
                <span className="capitalize">{o}</span>
              </label>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded border border-slate-300 px-3 py-2"
              placeholder="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
            {op !== "revoke" && (
              <input
                className="rounded border border-slate-300 px-3 py-2"
                placeholder={op === "rotate" ? "new plain secret" : "plain secret"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            )}
          </div>
          {op !== "rotate" && (
            <div className="mt-3">
              <div className="mb-1 text-sm font-medium">Targets (one event per target on RabbitMQ)</div>
              <div className="flex flex-wrap items-center gap-3">
                {OTHER_PEERS.map((p) => (
                  <label key={p} className="flex items-center gap-1">
                    <input type="checkbox" checked={targets.includes(p)} onChange={() => toggleTarget(p)} />
                    <span>{p}</span>
                  </label>
                ))}
                <button
                  type="button"
                  className="rounded bg-slate-200 px-2 py-1 text-xs"
                  onClick={() => setTargets([...OTHER_PEERS])}
                >
                  Select all
                </button>
                <button type="button" className="rounded bg-slate-200 px-2 py-1 text-xs" onClick={() => setTargets([])}>
                  Clear
                </button>
              </div>
            </div>
          )}
          {op === "rotate" && (
            <div className="mt-3 text-sm text-slate-500">
              rotate() re-uses the existing targets stored in <code>hmac_credential_target</code> for this clientId.
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button disabled={busy} className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50" onClick={submitOp}>
              Submit {op} + auto-sync
            </button>
            <button
              disabled={busy}
              className="rounded bg-slate-600 px-4 py-2 text-white disabled:opacity-50"
              onClick={refreshAll}
            >
              Refresh
            </button>
          </div>
          {result != null && (
            <pre className="mt-3 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Query another peer (HMAC-signed)</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">ClientId (local)</span>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={callClientId}
                onChange={(e) => setCallClientId(e.target.value)}
              >
                <option value="">-- pick a local clientId --</option>
                {localClients.map((c) => (
                  <option key={c.clientId} value={c.clientId}>
                    {c.clientId}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Target peer</span>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={callTarget}
                onChange={(e) => setCallTarget(e.target.value)}
              >
                {OTHER_PEERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            disabled={busy || !callClientId}
            className="mt-3 rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
            onClick={callOther}
          >
            GET /api/echo on {callTarget}
          </button>
          {callResult != null && (
            <pre className="mt-3 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
              {JSON.stringify(callResult, null, 2)}
            </pre>
          )}
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">Local MariaDB state (next_db)</h2>
          <pre className="max-h-72 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
            {JSON.stringify(dbState, null, 2)}
          </pre>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">All peers&apos; Redis (direct connection)</h2>
          <pre className="max-h-96 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
            {JSON.stringify(peerRedis, null, 2)}
          </pre>
        </section>
      </div>
    </div>
  );
}
