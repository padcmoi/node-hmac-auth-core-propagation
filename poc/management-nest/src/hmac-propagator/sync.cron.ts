import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { HmacPropagatorService } from "./hmac-propagator.service.js";

@Injectable()
export class SyncCron {
  private readonly logger = new Logger(SyncCron.name);

  constructor(@Inject(HmacPropagatorService) private readonly propagator: HmacPropagatorService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick() {
    try {
      const summary = await this.propagator.sync();
      if (summary.targetsPublished > 0 || summary.targetsRetrying > 0) {
        this.logger.log(`sync: ${JSON.stringify(summary)}`);
      }
    } catch (err) {
      this.logger.warn(`sync failed: ${(err as Error).message}`);
    }
  }
}
