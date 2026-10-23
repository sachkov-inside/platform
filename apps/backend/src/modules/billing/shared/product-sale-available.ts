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
  if (catalog === undefined) return false;
  const ids =
    snapshot.product === undefined
      ? snapshot.offer.benefits
          .filter(isProductCapability)
          .map(productIdFromCapability)
          .filter((id): id is string => id !== null)
      : [snapshot.product.id];
  if (ids.length !== 1) return false;
  const rows = await catalog.resolve(
    { productIds: ids, materialIds: [] },
    handle,
  );
  return rows.some(
    (row) => row.kind === "product" && row.id === ids[0] && row.available,
  );
}
