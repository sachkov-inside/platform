import type { CoverageCatalog } from "../../account-rights/index.js";
import type { TransactionHandle } from "../../../infrastructure/prisma/transaction-handle.js";
import type { PriceSnapshot } from "../domain/pricing.js";
import {
  productIdFromCapability,
  isProductCapability,
} from "@inside/access-capabilities";
/** Product metadata is read through its owner under the same opaque transaction as payment admission. */
export async function productSaleAvailable(
  catalog: Pick<CoverageCatalog, "resolve"> | undefined,
  snapshot: PriceSnapshot,
  handle: TransactionHandle,
): Promise<boolean> {
  const [available] = await productsSaleAvailable(catalog, [snapshot], handle);
  return available === true;
}

/** The same check for a page of snapshots with one catalogue read, in snapshot order. */
export async function productsSaleAvailable(
  catalog: Pick<CoverageCatalog, "resolve"> | undefined,
  snapshots: readonly PriceSnapshot[],
  handle: TransactionHandle,
): Promise<boolean[]> {
  const ids = snapshots.map(saleProductId);
  const productIds = [
    ...new Set(ids.filter((id): id is string => id !== null)),
  ];
  if (catalog === undefined || productIds.length === 0)
    return ids.map(() => false);
  const rows = await catalog.resolve({ productIds, materialIds: [] }, handle);
  const available = new Set(
    rows
      .filter((row) => row.kind === "product" && row.available)
      .map((row) => row.id),
  );
  return ids.map((id) => id !== null && available.has(id));
}

/** The single Product a snapshot sells; an offer naming none or several sells nothing. */
function saleProductId(snapshot: PriceSnapshot): string | null {
  if (snapshot.product !== undefined) return snapshot.product.id;
  const ids = snapshot.offer.benefits
    .filter(isProductCapability)
    .map(productIdFromCapability)
    .filter((id): id is string => id !== null);
  return ids.length === 1 ? (ids[0] ?? null) : null;
}
