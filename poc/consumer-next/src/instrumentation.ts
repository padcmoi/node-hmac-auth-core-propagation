// Runs once per Next.js server process before any request is handled.
// We use it to eagerly boot the HMAC propagator so the AMQP consumer
// subscribes at process start, matching Nuxt's nitro-plugin behaviour.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getHmacPropagatorService } = await import("@/lib/services/hmac-propagator.service");
  await getHmacPropagatorService();
  console.info("[next-peer] propagator booted via instrumentation hook");
}
