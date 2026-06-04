import { getHmacPropagatorService } from "../services/hmac-propagator.service";

export default defineEventHandler(async () => {
  const { propagator } = await getHmacPropagatorService();
  return await propagator.sync();
});
