import { getHmacPropagatorService } from "../services/hmac-propagator.service";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ clientId: string; targets: string[] }>(event);
  const { propagator } = await getHmacPropagatorService();
  const result = await propagator.revoke({ clientId: body.clientId, targets: body.targets });
  const sync = await propagator.sync();
  return { ...result, sync };
});
