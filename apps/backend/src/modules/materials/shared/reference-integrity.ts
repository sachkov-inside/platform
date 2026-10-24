import type { ProductMemberships } from "../../products/index.js";
import type { MaterialMetadata } from "../domain/material-metadata.js";
import type { MaterialId } from "../domain/material-identifiers.js";
import type { MaterialsPrismaTransaction } from "../../../infrastructure/prisma/index.js";
import {
  findReferenceIssues,
  findProductOrdinalConflict,
} from "../infrastructure/postgres/reference-integrity-persistence.js";
import type {
  InvalidReferenceError,
  ProductOrdinalConflictError,
} from "../facets/material-authoring/material-authoring.contract.js";
import type { Rollback } from "./application-result.js";

type ReferenceIntegrityError =
  InvalidReferenceError | ProductOrdinalConflictError;

export async function requireReferenceIntegrity(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  metadata: MaterialMetadata,
  rollback: Rollback<ReferenceIntegrityError>,
  products: ProductMemberships,
): Promise<void> {
  const issues = await findReferenceIssues(
    transaction,
    materialId,
    metadata,
    products,
  );
  if (issues.length > 0) {
    rollback({ code: "invalid_reference", issues });
  }
  const conflict = await findProductOrdinalConflict(
    transaction,
    materialId,
    metadata,
    products,
  );
  if (conflict !== undefined) {
    rollback({ code: "product_ordinal_conflict", ...conflict });
  }
}
