import type { ContentWriteTarget } from "../../domain/content-write-policy.js";
import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";
import type { MaterialId } from "../../domain/material-identifiers.js";
import { lockMaterialSeries } from "./series-order.js";

/** Call before relation replacement; unchanged placements retain their existing owner. */
export async function loadChangedProductMemberships(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  selectedIds: readonly string[],
): Promise<readonly ContentWriteTarget[]> {
  await lockMaterialSeries(transaction, materialId, selectedIds);
  const current = await transaction.productMembership.findMany({
    where: { materialId },
    select: { seriesId: true },
  });
  const before = new Set(current.map(({ seriesId }) => seriesId));
  const after = new Set(selectedIds);
  const changed = [...new Set([...before, ...after])].filter(
    (id) => before.has(id) !== after.has(id),
  );
  if (changed.length === 0) return [];
  const products = await transaction.product.findMany({
    where: { id: { in: changed } },
    select: { id: true, sourceId: true },
  });
  return products.map((product) => ({
    kind: "membership",
    sourceId: product.sourceId,
    path: selectedIds.includes(product.id)
      ? `/metadata/seriesIds/${String(selectedIds.indexOf(product.id))}`
      : "/metadata/seriesIds",
  }));
}
