import type { ProductMemberships } from "../../../products/index.js";
import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";
import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
export function loadChangedProductMemberships(
  transaction: MaterialsPrismaTransaction,
  materialId: string,
  selectedIds: readonly string[],
  products: ProductMemberships,
) {
  return products.changedTargets(
    materialId,
    selectedIds,
    transactionHandle(transaction),
  );
}
