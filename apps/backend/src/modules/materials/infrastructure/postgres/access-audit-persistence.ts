import { randomUUID } from "node:crypto";

import type {
  AccessDecision,
  Subject,
} from "../../application/ports/content-access.js";
import type {
  MaterialId,
  MaterialRevisionId,
} from "../../domain/material-identifiers.js";
import type { AuthoringDatabase } from "./database.js";

export async function recordMaterialAccessDecision(
  database: AuthoringDatabase,
  values: {
    readonly subject: Subject;
    readonly action: "preview" | "read";
    readonly materialId: MaterialId;
    readonly revisionId: MaterialRevisionId;
    readonly decision: AccessDecision;
  },
): Promise<void> {
  await database
    .insertInto("material_access_audit_events")
    .values({
      id: randomUUID(),
      material_id: values.materialId,
      revision_id: values.revisionId,
      actor_id:
        values.subject.kind === "principal"
          ? values.subject.principalId
          : null,
      action: values.action,
      decision: values.decision.allowed ? "allow" : "deny",
    })
    .executeTakeFirstOrThrow();
}
