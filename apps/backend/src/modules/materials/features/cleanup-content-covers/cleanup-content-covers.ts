import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import { Prisma, type MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";

const CLEANUP_CLAIM = "cleanup_claimed";
const CLEANUP_BATCH_SIZE = 100;

export interface ContentCoverMaintenance {
  cleanup(input: Readonly<{ graceMs: number; now?: Date }>): Promise<
    Readonly<{ cleaned: number; retained: number }>
  >;
}

export function assembleContentCoverMaintenance(dependencies: {
  readonly prisma: MaterialsPrismaClient;
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
          const initial = await transaction.contentCover.findUnique({ where: candidate });
          if (initial === null) return null;
          const owner = initial.materialId !== null
            ? { kind: "material", id: initial.materialId }
            : initial.topicId !== null
              ? { kind: "topic", id: initial.topicId }
              : { kind: "series", id: initial.seriesId };
          await transaction.$executeRaw(Prisma.sql`
            select pg_advisory_xact_lock(hashtextextended(${`${owner.kind}:${owner.id}`}, 0))
          `);
          const cover = await transaction.contentCover.findUnique({
            where: candidate,
            include: { renditions: true },
          });
          if (cover === null) return null;
          if (cover.failureCode !== CLEANUP_CLAIM &&
            (cover.orphanedAt > cutoff || cover.updatedAt > cutoff)) return null;
          const references = await Promise.all([
            transaction.material.count({ where: { coverId: cover.id } }),
            transaction.topic.count({ where: { coverId: cover.id } }),
            transaction.series.count({ where: { coverId: cover.id } }),
            transaction.publishedMaterial.count({ where: { coverId: cover.id } }),
          ]);
          if (references.some((count) => count > 0) || cover.currentlyReferenced) {
            const referenced = references.some((count) => count > 0);
            await transaction.contentCover.update({
              where: candidate,
              data: { currentlyReferenced: referenced, orphanedAt: now, updatedAt: now },
            });
            return { kind: "retained" as const };
          }
          await transaction.contentCover.update({
            where: candidate,
            data: { state: "failed", failureCode: CLEANUP_CLAIM, updatedAt: now },
          });
          return { kind: "claimed" as const, keys: cover.renditions.map((row) => row.publicObjectKey) };
        });
        if (claim === null) continue;
        if (claim.kind === "retained") {
          retained += 1;
          continue;
        }
        // Deletion is idempotent. Retain every key if any call fails, including
        // a crash after S3 succeeds but before the database row is removed.
        for (const key of claim.keys) await objectStorage.delete("public", key);
        const deleted = await prisma.contentCover.deleteMany({
          where: { id: candidate.id, failureCode: CLEANUP_CLAIM, currentlyReferenced: false },
        });
        cleaned += deleted.count;
      }
      return { cleaned, retained };
    },
  };
}
