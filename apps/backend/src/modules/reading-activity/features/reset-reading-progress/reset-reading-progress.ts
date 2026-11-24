import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockReadingCommand,
  lockReadingPair,
  type ReadingActivityPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

/** One chapter at most; the bound matches the batch read of reading states. */
export const resetReadingProgressBodySchema = z
  .object({
    materialIds: z.array(z.uuid()).min(1).max(100),
    commandId: z.uuid(),
  })
  .strict();

export const resetReadingProgressOutcomeSchema = z
  .object({ resetCount: z.number().int().nonnegative() })
  .strict();

const commandSchema = resetReadingProgressBodySchema.extend({
  accountId: z.uuid(),
});

export type ResetReadingProgressResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly resetCount: number;
        readonly replayed: boolean;
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          "invalid_request" | "command_conflict" | "dependency_unavailable";
      };
    };

/**
 * Starts the given Materials over for one Account, as the reader resetting a chapter: every
 * studied mark is removed the way a manual unmark removes it (a new version and a
 * `material_marked_unread` event), and the opened parts of step-by-step lessons are forgotten.
 * Like an unmark, it needs no current access: an Account may always clear its own progress.
 * One command is applied once; a retry with the same command ID answers from its receipt.
 * `resetCount` counts the studied marks removed.
 */
export async function resetReadingProgress(
  dependencies: { readonly prisma: ReadingActivityPrismaClient },
  input: {
    readonly accountId: string;
    readonly materialIds: readonly string[];
    readonly commandId: string;
  },
): Promise<ResetReadingProgressResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const accountId = parsed.data.accountId.toLowerCase();
  const commandId = parsed.data.commandId.toLowerCase();
  // Sorted, so concurrent resets take the pair locks in one order.
  const materialIds = [
    ...new Set(parsed.data.materialIds.map((id) => id.toLowerCase())),
  ].sort();
  const fingerprint = JSON.stringify(["resetReadingProgress", materialIds]);
  try {
    return await dependencies.prisma.$transaction(
      async (transaction): Promise<ResetReadingProgressResult> => {
        await lockReadingCommand(transaction, accountId, commandId);
        const receipt = await transaction.readingCommand.findUnique({
          where: { accountId_commandId: { accountId, commandId } },
        });
        if (receipt !== null) {
          if (receipt.fingerprint !== fingerprint)
            return { ok: false, error: { code: "command_conflict" } };
          const { resetCount } = resetReadingProgressOutcomeSchema.parse(
            receipt.outcome,
          );
          return { ok: true, value: { resetCount, replayed: true } };
        }
        for (const materialId of materialIds)
          await lockReadingPair(transaction, accountId, materialId);
        const read = await transaction.readingMaterialState.findMany({
          where: { accountId, materialId: { in: materialIds }, isRead: true },
          orderBy: { materialId: "asc" },
        });
        const now = new Date();
        for (const row of read) {
          const version = row.version + 1;
          await transaction.readingMaterialState.update({
            where: {
              accountId_materialId: { accountId, materialId: row.materialId },
            },
            data: { isRead: false, readAt: null, version, updatedAt: now },
          });
          await transaction.readingEvent.create({
            data: {
              accountId,
              materialId: row.materialId,
              eventId: randomUUID(),
              eventType: "material_marked_unread",
              stateVersion: version,
              occurredAt: now,
              commandId,
              schemaVersion: 1,
            },
          });
        }
        await transaction.readingLessonOpenedParts.deleteMany({
          where: { accountId, materialId: { in: materialIds } },
        });
        const outcome = { resetCount: read.length };
        await transaction.readingCommand.create({
          data: { accountId, commandId, fingerprint, outcome },
        });
        return { ok: true, value: { ...outcome, replayed: false } };
      },
    );
  } catch (error) {
    return dependencyFailure(
      { module: "reading-activity", operation: "resetReadingProgress" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
