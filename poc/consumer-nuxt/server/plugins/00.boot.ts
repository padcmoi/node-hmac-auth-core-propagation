import { getHmacPropagatorService } from "../services/hmac-propagator.service";

export default defineNitroPlugin(async () => {
  const { propagator } = await getHmacPropagatorService();

  // Naive sync cron via setInterval (the lib never schedules itself).
  setInterval(async () => {
    try {
      const summary = await propagator.sync();
      if (summary.targetsPublished > 0 || summary.targetsRetrying > 0) {
        console.info(`[nuxt-peer] sync ${JSON.stringify(summary)}`);
      }
    } catch (err) {
      console.warn(`[nuxt-peer] sync failed: ${(err as Error).message}`);
    }
  }, 10_000).unref();
});
