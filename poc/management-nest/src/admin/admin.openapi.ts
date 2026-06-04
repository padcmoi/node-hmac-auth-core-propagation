import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";

// Side-effect imports: each ./dto/*.openapi attaches @ApiProperty metadata to its DTO classes.
import "./dto/call-target.openapi.js";
import "./dto/ensure.openapi.js";
import "./dto/hash.openapi.js";
import "./dto/revoke.openapi.js";
import "./dto/rotate.openapi.js";
import "./dto/state.openapi.js";
import "./dto/sync-summary.openapi.js";
import "./dto/target.openapi.js";

import { CallTargetResponseDto } from "./dto/call-target.dto.js";
import { EnsureResponseDto } from "./dto/ensure.dto.js";
import { HashResponseDto } from "./dto/hash.dto.js";
import { RevokeResponseDto } from "./dto/revoke.dto.js";
import { RotateResponseDto } from "./dto/rotate.dto.js";
import { StateResponseDto } from "./dto/state.dto.js";
import { SyncSummaryDto } from "./dto/sync-summary.dto.js";
import { TargetMutationResponseDto } from "./dto/target.dto.js";

export const AdminApiTag = ApiTags("admin");

export const EnsureApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "Add or update a credential",
      description:
        "Inserts/updates the row in `hmac_credential` (Table 1) and marks every requested target as `pending` in `hmac_credential_target` (Table 3). The actual AMQP publish happens on the next sync tick.",
    }),
    ApiResponse({ status: 201, type: EnsureResponseDto })
  );

export const RotateApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "Rotate the plain of an existing credential",
      description:
        "Updates Table 1 with the new plain and resets every Table 3 row of this clientId to `pending`. The lib re-reads the existing targets from the BDD: no `targets` field in the request body.",
    }),
    ApiResponse({ status: 201, type: RotateResponseDto })
  );

export const RevokeApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "Propagate a delete across the mesh",
      description:
        "NULLs the plain in Table 1 and marks every requested target as pending with `op=credential.delete`. The next sync publishes the delete event.",
    }),
    ApiResponse({ status: 201, type: RevokeResponseDto })
  );

export const SyncApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "Run the sync pipeline now",
      description:
        "Reads every (`pending`, `sent`) row via `management.fetchPendingPropagations`, applies the local hash, publishes one AMQP event per target signed with that target's `propagationSecret`. Idempotent.",
    }),
    ApiResponse({ status: 201, type: SyncSummaryDto })
  );

export const StateApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "Inspect Tables 1, 2 and 3",
      description:
        "Returns the raw rows of `hmac_credential`, `hmac_propagation_target` and `hmac_credential_target` for this peer's MariaDB schema.",
    }),
    ApiResponse({ status: 200, type: StateResponseDto })
  );

export const CallTargetApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "Fire an HMAC-signed GET against another peer",
      description:
        "Builds a signed-fetch client with `hashToken = HMAC_SECRET_TOKEN` so the client-side hash matches what the peer stored. Used by the POC to prove the propagated credential verifies end-to-end.",
    }),
    ApiResponse({ status: 201, type: CallTargetResponseDto })
  );

export const HashApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "Compute the hash for a plain (debug helper)",
      description:
        "Returns `hashClientSecret(plain, HMAC_SECRET_TOKEN)`. Useful to manually check what the stored hash should look like after a sync.",
    }),
    ApiParam({ name: "plain", description: "Plain secret to hash.", example: "plain-text-secret" }),
    ApiResponse({ status: 200, type: HashResponseDto })
  );

export const CreateTargetApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "Add or update a propagation target (Table 2)",
      description:
        "Upserts a row in `hmac_propagation_target`. Adding a target makes it available to subsequent ensure/rotate/revoke calls. Updating overwrites the `propagationSecret` and `note` while preserving the FK identity.",
    }),
    ApiResponse({ status: 201, type: TargetMutationResponseDto })
  );

export const DeleteTargetApi = () =>
  applyDecorators(
    ApiOperation({
      summary: "Remove a propagation target (Table 2)",
      description:
        "Drops the row from `hmac_propagation_target` after cascading the dependent `hmac_credential_target` rows in the same transaction (the FK is `ON DELETE RESTRICT` so we delete the pivots explicitly). Refuses to delete the peer's own self-target row.",
    }),
    ApiParam({ name: "queue", description: "Target AMQP queue name to delete.", example: "partner-x" }),
    ApiResponse({ status: 200, type: TargetMutationResponseDto })
  );
