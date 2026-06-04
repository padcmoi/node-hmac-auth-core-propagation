import { getHmacPropagatorService } from "../services/hmac-propagator.service";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ clientId: string; secret: string }>(event);
  const { propagator } = await getHmacPropagatorService();
  const result = await propagator.rotate({ clientId: body.clientId, secret: body.secret });
  const sync = await propagator.sync();
  return { ...result, sync };
});
