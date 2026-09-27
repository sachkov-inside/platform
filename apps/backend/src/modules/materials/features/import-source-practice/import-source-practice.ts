import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { practiceDefinitionDigest } from "../../domain/practice-definition.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { executeAuthoringTransaction } from "../../shared/application-result.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { lockPracticeMaterial } from "./practice-import-locks.js";
import { lockPracticeImport } from "../../../../infrastructure/prisma/index.js";
import {
  applySourcePracticeBodySchema,
  practiceImportReceiptSchema,
  type ApplySourcePracticeOperation,
  type PracticeImportReceipt,
  type PracticeImportError,
  sourcePracticeSchema,
  type ValidateSourcePracticeOperation,
} from "./import-source-practice.contract.js";

const commandSchema = applySourcePracticeBodySchema
  .extend({
    actor: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();
const operation = "apply_source_practice";

export function assembleValidateSourcePractice(
  dependencies: Pick<MaterialAuthoringDependencies, "prisma" | "authorPolicy">,
): ValidateSourcePracticeOperation {
  return async (input) => {
    const parsed = sourcePracticeSchema
      .extend({ actor: z.uuid() })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    const authorized = await authorizeManager(
      dependencies.authorPolicy,
      parsed.data.actor,
    );
    if (!authorized.ok) return authorized;
    try {
      const current = await dependencies.prisma.practiceDefinition.findUnique({
        where: { practiceId: parsed.data.practiceId },
      });
      return {
        ok: true,
        value: {
          valid: true,
          current:
            current === null
              ? null
              : practiceImportReceiptSchema.parse({
                  practiceId: current.practiceId,
                  practiceVersion: Number(current.practiceVersion),
                  definitionDigest: current.definitionDigest,
                  materialId: current.materialId,
                  boundContentVersion: Number(current.boundContentVersion),
                  publicationState: current.publicationState,
                }),
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "validateSourcePractice" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  };
}

export function assembleApplySourcePractice(
  dependencies: Pick<MaterialAuthoringDependencies, "prisma" | "authorPolicy">,
): ApplySourcePracticeOperation {
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
    const fingerprint = fingerprintCommand({ operation, ...command });
    return executeAuthoringTransaction<
      PracticeImportReceipt,
      PracticeImportError
    >(
      dependencies.prisma,
      async (transaction, rollback) => {
        const key = {
          actorId: command.actor,
          operation,
          idempotencyKey: command.idempotencyKey,
        };
        const claim = await transaction.practiceImportReceipt.createMany({
          data: { ...key, requestFingerprint: fingerprint },
          skipDuplicates: true,
        });
        if (claim.count === 0) {
          const previous =
            await transaction.practiceImportReceipt.findUniqueOrThrow({
              where: { actorId_operation_idempotencyKey: key },
            });
          if (previous.requestFingerprint !== fingerprint)
            return rollback({ code: "idempotency_conflict" });
          // Historical receipt only; callers must read again to learn the current state.
          return practiceImportReceiptSchema.parse(previous.receipt);
        }
        await lockPracticeImport(transaction, command.practiceId);
        const material = await lockPracticeMaterial(
          transaction,
          command.materialId,
        );
        if (
          material === undefined ||
          material.content_version !== command.expectedContentVersion ||
          material.source_id !== command.sourceReference.materialSourceId ||
          material.source_revision !==
            command.sourceReference.materialSourceRevision ||
          (command.publicationState === "published" &&
            material.publication_state !== "published")
        )
          return rollback({ code: "source_mismatch" });
        const current = await transaction.practiceDefinition.findUnique({
          where: { practiceId: command.practiceId },
        });
        if (
          (current === null ? null : Number(current.practiceVersion)) !==
          command.expectedPracticeVersion
        )
          return rollback({ code: "practice_version_conflict" });
        const practiceVersion =
          current === null ? 1 : Number(current.practiceVersion) + 1;
        if (!Number.isSafeInteger(practiceVersion))
          throw new Error("Practice version overflow");
        const definitionDigest = practiceDefinitionDigest(
          command.definition,
          command.sourceReference,
        );
        const values = {
          materialId: command.materialId,
          definition: command.definition,
          definitionDigest,
          practiceVersion: BigInt(practiceVersion),
          boundSourceId: command.sourceReference.materialSourceId,
          boundSourceRevision: command.sourceReference.materialSourceRevision,
          boundContentVersion: BigInt(command.expectedContentVersion),
          publicationState: command.publicationState,
          sourceRepository: command.provenance.repository,
          sourceCommit: command.provenance.commit,
          sourcePath: command.provenance.path,
          updatedAt: new Date(),
        };
        await transaction.practiceDefinition.upsert({
          where: { practiceId: command.practiceId },
          create: { practiceId: command.practiceId, ...values },
          update: values,
        });
        const receipt: PracticeImportReceipt = {
          practiceId: command.practiceId,
          practiceVersion,
          definitionDigest,
          materialId: command.materialId,
          boundContentVersion: command.expectedContentVersion,
          publicationState: command.publicationState,
        };
        await transaction.practiceImportReceipt.update({
          where: { actorId_operation_idempotencyKey: key },
          data: { receipt },
        });
        return receipt;
      },
      mapPostgresReadError,
      "applySourcePractice",
    );
  };
}
