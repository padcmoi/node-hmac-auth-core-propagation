<script setup lang="ts">
const SELF = "nuxt";
const ALL_PEERS = ["mgmt-nest", "c-nest", "nuxt", "next"] as const;
const PEER_URLS: Record<string, string> = {
  "mgmt-nest": "http://management-nest:3001/api/echo",
  "c-nest": "http://consumer-nest:3002/api/echo",
  nuxt: "http://consumer-nuxt:3003/api/echo",
  next: "http://consumer-next:3004/api/echo",
};

const otherPeers = ALL_PEERS.filter((p) => p !== SELF);

const { data: peerRedis, refresh: refreshPeers } = await useFetch("/api/peer-redis");
const { data: dbState, refresh: refreshDb } = await useFetch("/api/state");
const { data: localClients, refresh: refreshLocal } = await useFetch("/api/local-clients");

// Live tail of the four-peer Redis state. Cheap glob (`hmac:*`) so 1s is fine.
let peerRedisTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  peerRedisTimer = setInterval(() => refreshPeers(), 1000);
});
onUnmounted(() => {
  if (peerRedisTimer) clearInterval(peerRedisTimer);
});

const form = reactive({
  op: "ensure" as "ensure" | "rotate" | "revoke",
  clientId: "",
  secret: "",
  targets: [] as string[],
});

const callForm = reactive({ clientId: "", target: otherPeers[0]! });
const targetForm = reactive({ targetAmqpQueue: "", propagationSecret: "", note: "" });

const lastResult = ref<unknown>(null);
const callResult = ref<unknown>(null);
const targetResult = ref<unknown>(null);
const isBusy = ref(false);

interface PropagationTarget {
  target_amqp_queue: string;
  propagation_secret: string;
  note: string | null;
}
const dbTargets = computed<PropagationTarget[]>(() => {
  const state = dbState.value as { targets?: PropagationTarget[] } | null;
  return state?.targets ?? [];
});

async function refreshAll() {
  await Promise.all([refreshDb(), refreshPeers(), refreshLocal()]);
}

async function submitOp() {
  isBusy.value = true;
  try {
    let url: string;
    let body: Record<string, unknown>;
    if (form.op === "ensure") {
      url = "/api/ensure";
      body = { clientId: form.clientId, secret: form.secret, targets: form.targets };
    } else if (form.op === "rotate") {
      url = "/api/rotate";
      body = { clientId: form.clientId, secret: form.secret };
    } else {
      url = "/api/revoke";
      body = { clientId: form.clientId, targets: form.targets };
    }
    lastResult.value = await $fetch(url, { method: "POST", body });
    await refreshAll();
  } finally {
    isBusy.value = false;
  }
}

async function callTarget() {
  isBusy.value = true;
  try {
    callResult.value = await $fetch("/api/call-target", {
      method: "POST",
      body: { target: PEER_URLS[callForm.target], clientId: callForm.clientId },
    });
  } finally {
    isBusy.value = false;
  }
}

function selectAllTargets() {
  form.targets = [...otherPeers];
}
function clearTargets() {
  form.targets = [];
}

async function submitTarget() {
  isBusy.value = true;
  try {
    targetResult.value = await $fetch("/api/targets", {
      method: "POST",
      body: {
        targetAmqpQueue: targetForm.targetAmqpQueue,
        propagationSecret: targetForm.propagationSecret,
        note: targetForm.note || undefined,
      },
    });
    targetForm.targetAmqpQueue = "";
    targetForm.propagationSecret = "";
    targetForm.note = "";
    await refreshDb();
  } finally {
    isBusy.value = false;
  }
}

async function deleteTarget(queue: string) {
  isBusy.value = true;
  try {
    targetResult.value = await $fetch(`/api/targets/${encodeURIComponent(queue)}`, { method: "DELETE" });
    await refreshDb();
  } finally {
    isBusy.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 p-6 text-slate-900">
    <div class="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 class="text-2xl font-semibold">hmac-propagation POC peer (Nuxt v4)</h1>
        <p class="text-sm text-slate-600">
          Full mode. Drives <code class="rounded bg-slate-200 px-1">propagator.ensure / rotate / revoke</code> against its own
          MariaDB schema <code class="rounded bg-slate-200 px-1">nuxt_db</code>. Each action auto-syncs so its event is published
          immediately.
        </p>
      </header>

      <!-- Drive propagation -->
      <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="mb-3 text-lg font-medium">Drive propagation</h2>
        <div class="mb-3 flex gap-4">
          <label v-for="op in ['ensure', 'rotate', 'revoke'] as const" :key="op" class="flex items-center gap-1">
            <input v-model="form.op" type="radio" :value="op" />
            <span class="capitalize">{{ op }}</span>
          </label>
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <input v-model="form.clientId" class="rounded border border-slate-300 px-3 py-2" placeholder="clientId" />
          <input
            v-if="form.op !== 'revoke'"
            v-model="form.secret"
            class="rounded border border-slate-300 px-3 py-2"
            :placeholder="form.op === 'rotate' ? 'new plain secret' : 'plain secret'"
          />
        </div>
        <div v-if="form.op !== 'rotate'" class="mt-3">
          <div class="mb-1 text-sm font-medium">Targets (the lib publishes one event per target)</div>
          <div class="flex flex-wrap items-center gap-3">
            <label v-for="p in otherPeers" :key="p" class="flex items-center gap-1">
              <input v-model="form.targets" type="checkbox" :value="p" />
              <span>{{ p }}</span>
            </label>
            <button type="button" class="rounded bg-slate-200 px-2 py-1 text-xs" @click="selectAllTargets">Select all</button>
            <button type="button" class="rounded bg-slate-200 px-2 py-1 text-xs" @click="clearTargets">Clear</button>
          </div>
        </div>
        <div v-else class="mt-3 text-sm text-slate-500">
          rotate() re-uses the existing targets stored in <code>hmac_credential_target</code> for this clientId.
        </div>
        <div class="mt-4 flex gap-2">
          <button :disabled="isBusy" class="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50" @click="submitOp">
            Submit {{ form.op }} + auto-sync
          </button>
          <button :disabled="isBusy" class="rounded bg-slate-600 px-4 py-2 text-white disabled:opacity-50" @click="refreshAll">
            Refresh
          </button>
        </div>
        <pre v-if="lastResult" class="mt-3 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{{
          JSON.stringify(lastResult, null, 2)
        }}</pre>
      </section>

      <!-- Query another peer -->
      <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="mb-3 text-lg font-medium">Query another peer (HMAC-signed)</h2>
        <div class="grid gap-3 md:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-sm font-medium">ClientId (local)</span>
            <select v-model="callForm.clientId" class="w-full rounded border border-slate-300 px-3 py-2">
              <option value="">-- pick a local clientId --</option>
              <option v-for="c in localClients ?? []" :key="c.clientId" :value="c.clientId">{{ c.clientId }}</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-sm font-medium">Target peer</span>
            <select v-model="callForm.target" class="w-full rounded border border-slate-300 px-3 py-2">
              <option v-for="p in otherPeers" :key="p" :value="p">{{ p }}</option>
            </select>
          </label>
        </div>
        <button
          :disabled="isBusy || !callForm.clientId"
          class="mt-3 rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
          @click="callTarget"
        >
          GET /api/echo on {{ callForm.target }}
        </button>
        <pre v-if="callResult" class="mt-3 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{{
          JSON.stringify(callResult, null, 2)
        }}</pre>
      </section>

      <!-- Targets management (Table 2) -->
      <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="mb-3 text-lg font-medium">Propagation targets (Table 2)</h2>
        <p class="mb-3 text-sm text-slate-600">
          Add or remove rows in <code>hmac_propagation_target</code>. Each row carries the AMQP queue name of a peer and the
          shared <code>propagation_secret</code> used to sign outbound events to it. The row matching this peer's own queue (<code
            >{{ SELF }}</code
          >) is locked because it backs the inbound ACK signature.
        </p>
        <div class="grid gap-3 md:grid-cols-3">
          <input
            v-model="targetForm.targetAmqpQueue"
            class="rounded border border-slate-300 px-3 py-2"
            placeholder="targetAmqpQueue (e.g. partner-x)"
          />
          <input
            v-model="targetForm.propagationSecret"
            class="rounded border border-slate-300 px-3 py-2"
            placeholder="propagationSecret"
          />
          <input v-model="targetForm.note" class="rounded border border-slate-300 px-3 py-2" placeholder="note (optional)" />
        </div>
        <button
          :disabled="isBusy || !targetForm.targetAmqpQueue || !targetForm.propagationSecret"
          class="mt-3 rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
          @click="submitTarget"
        >
          Add / update target
        </button>
        <table class="mt-4 w-full text-sm">
          <thead class="bg-slate-100">
            <tr>
              <th class="px-3 py-2 text-left">target_amqp_queue</th>
              <th class="px-3 py-2 text-left">propagation_secret</th>
              <th class="px-3 py-2 text-left">note</th>
              <th class="px-3 py-2 text-right">action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in dbTargets" :key="t.target_amqp_queue" class="border-t">
              <td class="px-3 py-2 font-mono">{{ t.target_amqp_queue }}</td>
              <td class="px-3 py-2 font-mono">{{ t.propagation_secret }}</td>
              <td class="px-3 py-2">{{ t.note }}</td>
              <td class="px-3 py-2 text-right">
                <button
                  :disabled="isBusy || t.target_amqp_queue === SELF"
                  class="rounded bg-rose-600 px-3 py-1 text-xs text-white disabled:opacity-30"
                  @click="deleteTarget(t.target_amqp_queue)"
                >
                  {{ t.target_amqp_queue === SELF ? "self (locked)" : "Delete" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <pre v-if="targetResult" class="mt-3 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{{
          JSON.stringify(targetResult, null, 2)
        }}</pre>
      </section>

      <!-- Local MariaDB state -->
      <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="mb-3 text-lg font-medium">Local MariaDB state (nuxt_db)</h2>
        <pre class="max-h-72 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{{
          JSON.stringify(dbState, null, 2)
        }}</pre>
      </section>

      <!-- All peers' Redis (direct connection) -->
      <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="mb-3 text-lg font-medium">All peers' Redis (direct connection)</h2>
        <pre class="max-h-96 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{{
          JSON.stringify(peerRedis, null, 2)
        }}</pre>
      </section>
    </div>
  </div>
</template>
