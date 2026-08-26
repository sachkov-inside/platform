import { randomUUID } from "node:crypto";

import type { MaterialBodyOperations } from "../domain/material-body/material-body.js";
import type { MaterialRevision } from "../domain/material.js";
import type {
  MaterialId,
  MaterialRevisionId,
} from "../domain/material-identifiers.js";
import type { MaterialsPrisma } from "../../../infrastructure/prisma/index.js";
import { loadMaterialRevision } from "../infrastructure/postgres/material-revision-reader.js";
import type { SystemError } from "../facets/material-authoring/material-authoring.contract.js";
import type { Rollback } from "./application-result.js";

export async function requireMaterialRevision(
  prisma: MaterialsPrisma,
  materialBodyOperations: MaterialBodyOperations,
  materialId: MaterialId,
  revisionId: MaterialRevisionId,
  rollback: Rollback<SystemError>,
): Promise<MaterialRevision> {
  const revision = await loadMaterialRevision(
    prisma,
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
