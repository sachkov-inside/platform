import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { ContentCoversPersistenceClient } from "../../infrastructure/prisma.js";
import type { ContentCoverSelection } from "../../facets/content-covers/cover-selection.js";
import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import { lockContentCoverOwner } from "../../../../infrastructure/prisma/index.js";

const CLEANUP_CLAIM = "cleanup_claimed";
const CLEANUP_BATCH_SIZE = 100;

export interface ContentCoverMaintenance {
  cleanup(
    input: Readonly<{ graceMs: number; now?: Date }>,
  ): Promise<Readonly<{ cleaned: number; retained: number }>>;
}

export function assembleContentCoverMaintenance(dependencies: {
  readonly prisma: ContentCoversPersistenceClient;
  readonly selection: ContentCoverSelection;
  readonly objectStorage: Pick<ObjectStorage, "delete">;
}): ContentCoverMaintenance {
  const { prisma, objectStorage } = dependencies;
  return {
    async cleanup({ graceMs, now = new Date() }) {
      const cutoff = new Date(now.getTime() - graceMs);
      const candidates = await prisma.contentCover.findMany({
        where: {
          OR: [
            { failureCode: CLEANUP_CLAIM },
            { orphanedAt: { lte: cutoff }, updatedAt: { lte: cutoff } },
          ],
        },
        orderBy: [{ orphanedAt: "asc" }, { id: "asc" }],
        select: { id: true },
        take: CLEANUP_BATCH_SIZE,
      });
      let cleaned = 0;
      let retained = 0;
      for (const candidate of candidates) {
        const claim = await prisma.$transaction(async (transaction) => {
          const initial = await transaction.contentCover.findUnique({
            where: candidate,
          });
          if (initial === null) return null;
          const owner =
            initial.materialId !== null
              ? { kind: "material" as const, id: initial.materialId }
              : initial.topicId !== null
                ? { kind: "topic" as const, id: initial.topicId }
                : initial.seriesId !== null
                  ? { kind: "series" as const, id: initial.seriesId }
                  : null;
          // content_covers_exactly_one_owner makes an ownerless cover unreachable.
          if (owner === null) return null;
          await lockContentCoverOwner(transaction, owner);
          const cover = await transaction.contentCover.findUnique({
            where: candidate,
            include: { renditions: true },
          });
          if (cover === null) return null;
          if (
            cover.failureCode !== CLEANUP_CLAIM &&
            (cover.orphanedAt > cutoff || cover.updatedAt > cutoff)
          )
            return null;
          const referenced = await dependencies.selection.references(
            owner,
            cover.id,
            transactionHandle(transaction),
          );
          if (referenced || cover.currentlyReferenced) {
            await transaction.contentCover.update({
              where: candidate,
              data: {
                currentlyReferenced: referenced,
                orphanedAt: now,
                updatedAt: now,
              },
            });
            return { kind: "retained" as const };
          }
          await transaction.contentCover.update({
            where: candidate,
            data: {
              state: "failed",
              failureCode: CLEANUP_CLAIM,
              updatedAt: now,
            },
          });
          return {
            kind: "claimed" as const,
            uploadConfirmed: cover.uploadConfirmed,
            keys: cover.renditions.map((row) => row.publicObjectKey),
          };
        });
        if (claim === null) continue;
        if (claim.kind === "retained") {
          retained += 1;
          continue;
        }
        // Deletion is idempotent. Retain every key if any call fails, including
        // a crash after S3 succeeds but before the database row is removed.
        for (const key of claim.keys) await objectStorage.delete("public", key);
        // Use the claim-time value: a PUT may finish after DELETE and before
        // this database update. Keep its keys for another deletion pass.
        if (!claim.uploadConfirmed) {
          await prisma.contentCover.updateMany({
            where: { id: candidate.id, failureCode: CLEANUP_CLAIM },
            data: { orphanedAt: now, updatedAt: now },
          });
          retained += 1;
          continue;
        }
        const deleted = await prisma.contentCover.deleteMany({
          where: {
            id: candidate.id,
            failureCode: CLEANUP_CLAIM,
            currentlyReferenced: false,
            uploadConfirmed: true,
          },
        });
        cleaned += deleted.count;
      }
      return { cleaned, retained };
    },
  };
}
