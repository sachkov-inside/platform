import { z } from "zod";
import {
  lockTermDefinition,
  lockTermSource,
} from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  termUpdateConflict,
  termVersionSchema,
} from "../../domain/term-definition.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { executeAuthoringTransaction } from "../../shared/application-result.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import {
  sourceTermSchema,
  applySourceTermBodySchema,
  saveTermBodySchema,
  termImportReceiptSchema,
  type ApplySourceTermOperation,
  type SaveTermOperation,
  type ValidateSourceTermOperation,
  type TermImportReceipt,
  type TermMutationError,
} from "./import-source-term.contract.js";

type Dependencies = Pick<
  MaterialAuthoringDependencies,
  "prisma" | "authorPolicy"
>;
const identity = {
  actor: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(200),
};
const mutationSchema = applySourceTermBodySchema
  .extend({ source: sourceTermSchema.shape.source.nullable(), ...identity })
  .strict();

function receipt(row: {
  readonly termId: string;
  readonly termVersion: bigint;
  readonly definitionDigest: string;
  readonly publicationState: string;
  readonly sourceId: string | null;
  readonly sourceRevision: string | null;
}): TermImportReceipt {
  return termImportReceiptSchema.parse({
    termId: row.termId,
    termVersion: Number(row.termVersion),
    definitionDigest: row.definitionDigest,
    publicationState: row.publicationState,
    sourceId: row.sourceId,
    sourceRevision: row.sourceRevision,
  });
}

export function assembleValidateSourceTerm(
  dependencies: Dependencies,
): ValidateSourceTermOperation {
  return async (input) => {
    const parsed = sourceTermSchema
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
      const current = await dependencies.prisma.termDefinition.findUnique({
        where: { termId: parsed.data.definition.id },
      });
      const other = await dependencies.prisma.termDefinition.findUnique({
        where: { sourceId: parsed.data.source.id },
      });
      if (
        (current !== null && current.sourceId !== parsed.data.source.id) ||
        (other !== null &&
          other.termId !== parsed.data.definition.id.toLowerCase())
      )
        return { ok: false, error: { code: "source_mismatch" } };
      if (
        parsed.data.definition.materialId !== undefined &&
        (await dependencies.prisma.material.findUnique({
          where: { id: parsed.data.definition.materialId },
          select: { id: true },
        })) === null
      )
        return { ok: false, error: { code: "invalid_term_material" } };
      return {
        ok: true,
        value: {
          valid: true,
          current: current === null ? null : receipt(current),
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "validateSourceTerm" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  };
}

function assembleMutateTerm(
  dependencies: Dependencies,
  operation: "apply_source_term" | "save_term",
) {
  return async (input: z.infer<typeof mutationSchema>) => {
    const parsed = mutationSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false as const,
        error: { code: "invalid_request_shape" as const },
      };
    const command = parsed.data;
    const authorized = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorized.ok) return authorized;
    const fingerprint = fingerprintCommand({ operation, ...command });
    return executeAuthoringTransaction<TermImportReceipt, TermMutationError>(
      dependencies.prisma,
      async (transaction, rollback) => {
        const key = {
          actorId: command.actor,
          operation,
          idempotencyKey: command.idempotencyKey,
        };
        const claim = await transaction.termImportReceipt.createMany({
          data: { ...key, requestFingerprint: fingerprint },
          skipDuplicates: true,
        });
        if (claim.count === 0) {
          const previous =
            await transaction.termImportReceipt.findUniqueOrThrow({
              where: { actorId_operation_idempotencyKey: key },
            });
          if (previous.requestFingerprint !== fingerprint)
            return rollback({ code: "idempotency_conflict" });
          return termImportReceiptSchema.parse(previous.receipt);
        }
        const termId = command.definition.id.toLowerCase();
        await lockTermDefinition(transaction, termId);
        const current = await transaction.termDefinition.findUnique({
          where: { termId },
        });
        const conflict = termUpdateConflict(
          current === null
            ? null
            : {
                termVersion: Number(current.termVersion),
                sourceId: current.sourceId,
              },
          command.expectedTermVersion,
          command.source?.id ?? null,
        );
        if (conflict !== undefined) return rollback({ code: conflict });
        if (command.source !== null) {
          await lockTermSource(transaction, command.source.id);
          const other = await transaction.termDefinition.findUnique({
            where: { sourceId: command.source.id },
          });
          if (other !== null && other.termId !== termId)
            return rollback({ code: "source_mismatch" });
        }
        if (
          command.definition.materialId !== undefined &&
          (await transaction.material.findUnique({
            where: { id: command.definition.materialId },
            select: { id: true },
          })) === null
        )
          return rollback({ code: "invalid_term_material" });
        const termVersion = termVersionSchema.parse(
          current === null ? 1 : Number(current.termVersion) + 1,
        );
        const definitionDigest = fingerprintCommand({
          definition: command.definition,
          publicationState: command.publicationState,
        });
        const values = {
          definition: command.definition,
          definitionDigest,
          termVersion: BigInt(termVersion),
          publicationState: command.publicationState,
          detailedMaterialId: command.definition.materialId ?? null,
          sourceId: command.source?.id ?? current?.sourceId ?? null,
          sourcePath: command.source?.path ?? current?.sourcePath ?? null,
          // A manual edit retains the owner but breaks the source revision proof.
          sourceRevision: command.source?.revision ?? null,
          updatedAt: new Date(),
        };
        const result = receipt(
          await transaction.termDefinition.upsert({
            where: { termId },
            create: { termId, ...values },
            update: values,
          }),
        );
        await transaction.termImportReceipt.update({
          where: { actorId_operation_idempotencyKey: key },
          data: { receipt: result },
        });
        return result;
      },
      mapPostgresReadError,
      operation,
    );
  };
}

export function assembleApplySourceTerm(
  dependencies: Dependencies,
): ApplySourceTermOperation {
  const mutate = assembleMutateTerm(dependencies, "apply_source_term");
  return async (input) => {
    const parsed = applySourceTermBodySchema
      .extend(identity)
      .strict()
      .safeParse(input);
    return parsed.success
      ? mutate(parsed.data)
      : { ok: false, error: { code: "invalid_request_shape" } };
  };
}

export function assembleSaveTerm(
  dependencies: Dependencies,
): SaveTermOperation {
  const mutate = assembleMutateTerm(dependencies, "save_term");
  return async (input) => {
    const parsed = saveTermBodySchema
      .extend(identity)
      .strict()
      .safeParse(input);
    return parsed.success
      ? mutate({ ...parsed.data, source: null })
      : { ok: false, error: { code: "invalid_request_shape" } };
  };
}
