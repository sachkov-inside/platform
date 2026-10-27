import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import {
  applySourcePracticeBodySchema,
  practiceImportReceiptSchema,
  type ReadHistoricalPracticeReceiptOperation,
} from "./import-source-practice.contract.js";
const commandSchema = applySourcePracticeBodySchema
  .extend({
    actor: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();
export function assembleReadHistoricalPracticeReceipt(
  dependencies: Pick<MaterialAuthoringDependencies, "prisma" | "authorPolicy">,
): ReadHistoricalPracticeReceiptOperation {
  return async (input) => {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    const command = parsed.data;
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) return authorization;
    try {
      const prior = await dependencies.prisma.practiceImportReceipt.findUnique({
        where: {
          actorId_operation_idempotencyKey: {
            actorId: command.actor,
            operation: "apply_source_practice",
            idempotencyKey: command.idempotencyKey,
          },
        },
      });
      if (prior === null)
        return { ok: false, error: { code: "practice_definition_retired" } };
      if (
        prior.requestFingerprint !==
        fingerprintCommand({ operation: "apply_source_practice", ...command })
      )
        return { ok: false, error: { code: "idempotency_conflict" } };
      return {
        ok: true,
        value: practiceImportReceiptSchema.parse(prior.receipt),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "materials", operation: "readHistoricalPracticeReceipt" },
        error,
        {
          ok: false,
          error: { code: "dependency_unavailable", retryable: true },
        } as const,
      );
    }
  };
}
