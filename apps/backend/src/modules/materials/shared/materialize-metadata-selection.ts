import type { ProductMemberships } from "../../products/index.js";
import { transactionHandle } from "../../../infrastructure/prisma/transaction-handle.js";
import type { MaterialsPrismaTransaction } from "../../../infrastructure/prisma/index.js";
import type { MaterialId } from "../domain/material-identifiers.js";
import type {
  MaterialMetadata,
  MaterialMetadataSelection,
} from "../domain/material-metadata.js";

export async function materializeMetadataSelection(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  selection: MaterialMetadataSelection,
  slug: string | null,
  products: ProductMemberships,
): Promise<MaterialMetadata> {
  const values = selection.toValues();
  return selection.materialize(
    await products.assignSelected(
      materialId,
      values.productIds,
      transactionHandle(transaction),
    ),
    slug,
  );
}
