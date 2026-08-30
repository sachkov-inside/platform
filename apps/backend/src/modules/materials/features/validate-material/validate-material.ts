import { z } from "zod";

import type {
  ValidateMaterialError,
  ValidateMaterialOperation,
  ValidatedMaterialDto,
} from "./validate-material.contract.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { loadCurrentMaterial } from "../../infrastructure/postgres/current-material.js";
import { authorizeManager } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import {
  accountId,
  materialIdSchema,
  parseCommand,
} from "../../shared/command-validation.js";
import { mapPostgresValidationError } from "../../shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../../shared/reference-integrity.js";

const validateMaterialQuery = z
  .object({
    actor: accountId,
    materialId: materialIdSchema,
    expectedContentVersion: z.number().int().positive(),
  })
  .strict();

export function assembleValidateMaterial(
  dependencies: MaterialAuthoringDependencies,
): ValidateMaterialOperation {
  return async (input) => {
    const parsed = parseCommand(validateMaterialQuery, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }
    return executeAuthoringTransaction<ValidatedMaterialDto, ValidateMaterialError>(
      dependencies.prisma,
      async (transaction, rollback) => {
        const current = await loadCurrentMaterial(
          transaction,
          dependencies.materialBodyOperations,
          parsed.value.materialId,
        );
        if (current === undefined) {
          return rollback({ code: "material_not_found" });
        }
        if (!current.ok) {
          return rollback(current.error);
        }
        if (
          current.value.lifecycle.contentVersion !==
          parsed.value.expectedContentVersion
        ) {
          return rollback({
            code: "stale_content_version",
            currentContentVersion: current.value.lifecycle.contentVersion,
          });
        }
        const completeness = current.value.metadata.validateAuthoringCompleteness();
        if (!completeness.ok) {
          return rollback(completeness.error);
        }
        await requireReferenceIntegrity(
          transaction,
          parsed.value.materialId,
          current.value.metadata,
          rollback,
        );
        const extraction = dependencies.materialBodyOperations.extract(
          current.value.body,
        );
        if (!extraction.ok) {
          return rollback(extraction.error);
        }
        return {
          materialId: parsed.value.materialId,
          contentVersion: current.value.lifecycle.contentVersion,
          projectionDigest: fingerprintCommand({
            metadata: current.value.metadata.toValues(),
            extraction: extraction.value,
          }),
          extraction: extraction.value,
        };
      },
      mapPostgresValidationError,
    );
  };
}
