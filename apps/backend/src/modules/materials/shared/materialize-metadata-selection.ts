import type { MaterialsPrismaTransaction } from "../../../infrastructure/prisma/index.js";
import type { MaterialId } from "../domain/material-identifiers.js";
import type {
  MaterialMetadata,
  MaterialMetadataSelection,
} from "../domain/material-metadata.js";
import { appendSelectedSeriesMemberships } from "../infrastructure/postgres/series-order.js";

export async function materializeMetadataSelection(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  selection: MaterialMetadataSelection,
  slug: string | null,
): Promise<MaterialMetadata> {
  const values = selection.toValues();
  return selection.materialize(
    await appendSelectedSeriesMemberships(
      transaction,
      materialId,
      values.seriesIds,
    ),
    slug,
  );
}
