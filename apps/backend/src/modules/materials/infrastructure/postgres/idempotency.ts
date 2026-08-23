import type { AuthoringTransaction } from "./database.js";

export type AuthoringOperation = "create_draft" | "revise_draft";

export type IdempotencyClaim =
  | { readonly kind: "claimed" }
  | { readonly kind: "replay"; readonly materialId: string; readonly revisionId: string }
  | { readonly kind: "reused" }
  | { readonly kind: "incomplete" };

export async function claimIdempotency(
  transaction: AuthoringTransaction,
  values: {
    readonly actor: string;
    readonly operation: AuthoringOperation;
    readonly key: string;
    readonly fingerprint: string;
  },
): Promise<IdempotencyClaim> {
  const inserted = await transaction
    .insertInto("authoring_idempotency")
    .values({
      actor_id: values.actor,
      operation: values.operation,
      idempotency_key: values.key,
      request_fingerprint: values.fingerprint,
      material_id: null,
      revision_id: null,
    })
    .onConflict((conflict) =>
      conflict.columns(["actor_id", "operation", "idempotency_key"]).doNothing(),
    )
    .returning("request_fingerprint")
    .executeTakeFirst();

  if (inserted !== undefined) {
    return { kind: "claimed" };
  }

  const existing = await transaction
    .selectFrom("authoring_idempotency")
    .select(["request_fingerprint", "material_id", "revision_id"])
    .where("actor_id", "=", values.actor)
    .where("operation", "=", values.operation)
    .where("idempotency_key", "=", values.key)
    .executeTakeFirstOrThrow();

  if (existing.request_fingerprint.trim() !== values.fingerprint) {
    return { kind: "reused" };
  }
  if (existing.material_id === null || existing.revision_id === null) {
    return { kind: "incomplete" };
  }
  return {
    kind: "replay",
    materialId: existing.material_id,
    revisionId: existing.revision_id,
  };
}

export async function completeIdempotency(
  transaction: AuthoringTransaction,
  values: {
    readonly actor: string;
    readonly operation: AuthoringOperation;
    readonly key: string;
    readonly materialId: string;
    readonly revisionId: string;
  },
): Promise<void> {
  await transaction
    .updateTable("authoring_idempotency")
    .set({ material_id: values.materialId, revision_id: values.revisionId })
    .where("actor_id", "=", values.actor)
    .where("operation", "=", values.operation)
    .where("idempotency_key", "=", values.key)
    .executeTakeFirstOrThrow();
}
