import { randomUUID } from "node:crypto";

import type { MaterialRevision } from "../../domain/material.js";
import {
  materialId,
  materialRevisionId,
} from "../../domain/material-identifiers.js";
import type { AuthoringTransaction } from "../../infrastructure/postgres/database.js";
import {
  claimIdempotency,
  type AuthoringOperation,
} from "../../infrastructure/postgres/idempotency.js";
import { loadMaterialRevision } from "../../infrastructure/postgres/material-persistence.js";
import type { MaterialAuthoringDependencies } from "../material-authoring.dependencies.js";
import { rollback } from "./application-result.js";

export async function claimOrReplay(
  transaction: AuthoringTransaction,
  dependencies: Pick<MaterialAuthoringDependencies, "materialBodyOperations">,
  values: {
    readonly actor: string;
    readonly operation: AuthoringOperation;
    readonly key: string;
    readonly fingerprint: string;
  },
): Promise<MaterialRevision | undefined> {
  const claim = await claimIdempotency(transaction, values);
  if (claim.kind === "claimed") {
    return undefined;
  }
  if (claim.kind === "reused") {
    rollback({ code: "idempotency_key_reused" });
  }
  if (claim.kind === "incomplete") {
    rollback({ code: "internal_error", correlationId: randomUUID() });
  }
  const revision = await loadMaterialRevision(
    transaction,
    dependencies.materialBodyOperations,
    materialId(claim.materialId),
    materialRevisionId(claim.revisionId),
  );
  if (revision === undefined || !revision.ok) {
    rollback({ code: "internal_error", correlationId: randomUUID() });
  }
  return revision.value;
}
