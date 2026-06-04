import { getHmacPropagatorService } from "../services/hmac-propagator.service";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ clientId: string; secret: string; targets: string[] }>(event);
  const { propagator } = await getHmacPropagatorService();
  const result = await propagator.ensure({ clientId: body.clientId, secret: body.secret, targets: body.targets });
  // Auto-sync so each action produces its own AMQP message instead of being coalesced
  // by the next cron tick into a single snapshot of the BDD state.
  const sync = await propagator.sync();
  return { ...result, sync };
});
