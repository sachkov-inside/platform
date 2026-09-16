import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";
import type { MaterialId } from "../../domain/material-identifiers.js";
import { lockMaterialSeries } from "./series-order.js";

/** Call before relation replacement; unchanged placements retain their existing owner. */
export async function canChangeGuideMemberships(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  selectedIds: readonly string[],
  sourceId: string | null,
): Promise<boolean> {
  await lockMaterialSeries(transaction, materialId, selectedIds);
  const current = await transaction.guideMembership.findMany({
    where: { materialId }, select: { seriesId: true },
  });
  const before = new Set(current.map(({ seriesId }) => seriesId));
  const after = new Set(selectedIds);
  const changed = [...new Set([...before, ...after])].filter((id) => before.has(id) !== after.has(id));
  if (changed.length === 0) return true;
  const guides = await transaction.guide.findMany({
    where: { id: { in: changed } }, select: { sourceId: true },
  });
  return guides.every((guide) => (guide.sourceId === null) === (sourceId === null));
}
