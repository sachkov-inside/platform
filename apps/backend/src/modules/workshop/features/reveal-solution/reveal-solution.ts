import { createHash } from "node:crypto";

import { z } from "zod";

import type { WorkshopPrismaClient } from "../../infrastructure/prisma.js";
import { resolveCurrentCaseVersionAccess } from "../../shared/current-case-version-access.js";
import { workshopIdempotencyKeySchema } from "../../shared/workshop-validation.js";
import type {
  RevealWorkshopSolutionCommand,
  WorkshopRevealDto,
  WorkshopRevealResult,
} from "../../facets/workshop/workshop.interface.js";

const commandSchema = z
  .object({
    accountId: z.uuid(),
    caseVersionId: z.uuid(),
    idempotencyKey: workshopIdempotencyKeySchema,
  })
  .strict();

export async function revealWorkshopSolution(
  dependencies: {
    readonly prisma: WorkshopPrismaClient;
    readonly clock: () => Date;
    readonly id: () => string;
  },
  command: RevealWorkshopSolutionCommand,
): Promise<WorkshopRevealResult> {
  const parsed = commandSchema.safeParse(command);
  if (!parsed.success) return failure("invalid_request");
  const fingerprint = createHash("sha256")
    .update(parsed.data.caseVersionId)
    .digest("hex");
  try {
    return await dependencies.prisma.$transaction(async (transaction) => {
      const byKey = await transaction.workshopSolutionReveal.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: parsed.data.accountId,
            idempotencyKey: parsed.data.idempotencyKey,
          },
        },
      });
      if (byKey !== null) {
        return byKey.requestFingerprint === fingerprint
          ? success(byKey)
          : failure("idempotency_key_reused");
      }
      const access = await resolveCurrentCaseVersionAccess(
        transaction,
        parsed.data.accountId,
        parsed.data.caseVersionId,
        dependencies.clock(),
      );
      if (access === undefined) return failure("access_required");
      const material = await transaction.workshopCaseMaterial.findFirst({
        where: {
          caseVersionId: parsed.data.caseVersionId,
          releasePolicy: "solution_reveal",
        },
        select: { materialId: true },
      });
      if (material === null) return failure("material_not_found");
      const existing = await transaction.workshopSolutionReveal.findUnique({
        where: {
          accountId_caseVersionId: {
            accountId: parsed.data.accountId,
            caseVersionId: parsed.data.caseVersionId,
          },
        },
      });
      if (existing !== null) return success(existing);

      const created = await transaction.workshopSolutionReveal.create({
        data: {
          id: dependencies.id(),
          accountId: parsed.data.accountId,
          caseVersionId: parsed.data.caseVersionId,
          reason: "learner_requested",
          idempotencyKey: parsed.data.idempotencyKey,
          requestFingerprint: fingerprint,
          revealedAt: dependencies.clock(),
        },
      });
      return success(created);
    });
  } catch {
    try {
      const byKey = await dependencies.prisma.workshopSolutionReveal.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: parsed.data.accountId,
            idempotencyKey: parsed.data.idempotencyKey,
          },
        },
      });
      if (byKey !== null) {
        return byKey.requestFingerprint === fingerprint
          ? success(byKey)
          : failure("idempotency_key_reused");
      }
      const existing = await dependencies.prisma.workshopSolutionReveal.findUnique({
        where: {
          accountId_caseVersionId: {
            accountId: parsed.data.accountId,
            caseVersionId: parsed.data.caseVersionId,
          },
        },
      });
      return existing === null
        ? failure("dependency_unavailable")
        : success(existing);
    } catch {
      return failure("dependency_unavailable");
    }
  }
}

function success(row: {
  readonly id: string;
  readonly caseVersionId: string;
  readonly reason: string;
  readonly revealedAt: Date;
}): WorkshopRevealResult {
  if (row.reason !== "after_attempt" && row.reason !== "learner_requested") {
    return failure("dependency_unavailable");
  }
  const value: WorkshopRevealDto = {
    revealId: row.id,
    caseVersionId: row.caseVersionId,
    revealedAt: row.revealedAt.toISOString(),
    reason: row.reason,
  };
  return { ok: true, value };
}

function failure(
  code: Extract<WorkshopRevealResult, { readonly ok: false }>["error"]["code"],
): Extract<WorkshopRevealResult, { readonly ok: false }> {
  return { ok: false, error: { code } };
}
