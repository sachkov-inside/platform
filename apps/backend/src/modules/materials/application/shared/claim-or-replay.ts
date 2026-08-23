import { randomUUID } from "node:crypto";

import type { Material } from "../../domain/material.js";
import type { AuthoringTransaction } from "../../infrastructure/postgres/database.js";
import {
  claimIdempotency,
  type AuthoringOperation,
} from "../../infrastructure/postgres/idempotency.js";
import { loadMaterial } from "../../infrastructure/postgres/material-persistence.js";
import type { ContentAuthoringDependencies } from "../content-authoring.dependencies.js";
import { rollback } from "./application-result.js";

export async function claimOrReplay(
  transaction: AuthoringTransaction,
  dependencies: Pick<ContentAuthoringDependencies, "materialDocument">,
  values: {
    readonly actor: string;
    readonly operation: AuthoringOperation;
    readonly key: string;
    readonly fingerprint: string;
  },
): Promise<Material | undefined> {
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
  const material = await loadMaterial(
    transaction,
    dependencies.materialDocument,
    claim.materialId,
    claim.revisionId,
  );
  if (material === undefined || !material.ok) {
    rollback({ code: "internal_error", correlationId: randomUUID() });
  }
  return material.value;
}
