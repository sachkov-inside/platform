import { coverPersistence } from "../prisma.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { ContentCoverProjection } from "../../facets/content-covers/content-covers.js";

export async function loadContentCoverProjections(
  transaction: TransactionHandle,
  coverIds: readonly string[],
): Promise<ReadonlyMap<string, ContentCoverProjection>> {
  if (coverIds.length === 0) return new Map();
  const covers = await coverPersistence(transaction).contentCover.findMany({
    where: {
      id: { in: [...new Set(coverIds)] },
      currentlyReferenced: true,
      state: "ready",
    },
    include: { renditions: { orderBy: { width: "asc" } } },
  });
  return new Map(
    covers.map((cover) => [
      cover.id,
      {
        coverId: cover.id,
        renditions: cover.renditions.map(({ height, width }) => ({
          height,
          width,
        })),
      },
    ]),
  );
}
