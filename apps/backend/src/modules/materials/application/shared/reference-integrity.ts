import type { MaterialRevisionMetadata } from "../../domain/material-revision-metadata.js";
import type { MaterialId } from "../../domain/material-identifiers.js";
import type { AuthoringTransaction } from "../../infrastructure/postgres/database.js";
import {
  findReferenceIssues,
  findSeriesOrdinalConflict,
} from "../../infrastructure/postgres/reference-integrity-persistence.js";
import type {
  InvalidReferenceError,
  SeriesOrdinalConflictError,
} from "../material-authoring.interface.js";
import type { Rollback } from "./application-result.js";

type ReferenceIntegrityError =
  | InvalidReferenceError
  | SeriesOrdinalConflictError;

export async function requireReferenceIntegrity(
  transaction: AuthoringTransaction,
  materialId: MaterialId,
  metadata: MaterialRevisionMetadata,
  rollback: Rollback<ReferenceIntegrityError>,
): Promise<void> {
  const issues = await findReferenceIssues(transaction, metadata);
  if (issues.length > 0) {
    rollback({ code: "invalid_reference", issues });
  }
  const conflict = await findSeriesOrdinalConflict(transaction, materialId, metadata);
  if (conflict !== undefined) {
    rollback({ code: "series_ordinal_conflict", ...conflict });
  }
}
