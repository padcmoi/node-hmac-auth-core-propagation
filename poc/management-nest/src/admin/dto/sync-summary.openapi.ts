import { ApiProperty } from "@nestjs/swagger";
import { SyncSummaryDto } from "./sync-summary.dto.js";

ApiProperty({ type: Number, description: "Number of pending propagation rows read from MariaDB.", example: 1 })(
  SyncSummaryDto.prototype,
  "propagationsRead"
);
ApiProperty({ type: Number, description: "Number of (clientId, target) pairs published this sync.", example: 3 })(
  SyncSummaryDto.prototype,
  "targetsPublished"
);
ApiProperty({
  type: Number,
  description: "Number of (clientId, target) pairs whose publish failed and will be retried.",
  example: 0,
})(SyncSummaryDto.prototype, "targetsRetrying");
ApiProperty({ type: Number, description: "Wall-clock duration of the sync pass, in milliseconds.", example: 142 })(
  SyncSummaryDto.prototype,
  "durationMs"
);
