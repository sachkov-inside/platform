import { randomUUID } from "node:crypto";

import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import type { MaterialRevision } from "../../domain/material.js";
import type {
  MaterialId,
  MaterialRevisionId,
} from "../../domain/material-identifiers.js";
import type { AuthoringDatabase } from "../../infrastructure/postgres/database.js";
import { loadMaterialRevision } from "../../infrastructure/postgres/material-persistence.js";
import type { SystemError } from "../material-authoring.interface.js";
import type { Rollback } from "./application-result.js";

export async function requireMaterialRevision(
  database: AuthoringDatabase,
  materialBodyOperations: MaterialBodyOperations,
  materialId: MaterialId,
  revisionId: MaterialRevisionId,
  rollback: Rollback<SystemError>,
): Promise<MaterialRevision> {
  const revision = await loadMaterialRevision(
    database,
    materialBodyOperations,
    materialId,
    revisionId,
  );
  if (revision === undefined || !revision.ok) {
    return rollback({
      code: "internal_error",
      correlationId: randomUUID(),
    });
  }
  return revision.value;
}
