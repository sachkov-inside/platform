import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";

export type AuthoringOperation =
  | "create_draft"
  | "publish_revision"
  | "restore_revision"
  | "revise_draft"
  | "unpublish_material";

export type IdempotencyClaim =
  | { readonly kind: "claimed" }
  | {
      readonly kind: "replay";
      readonly materialId: string;
      readonly revisionId: string;
      readonly publicationEventId: string | null;
    }
  | { readonly kind: "reused" }
  | { readonly kind: "incomplete" };

export async function claimIdempotency(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly actor: string;
    readonly operation: AuthoringOperation;
    readonly key: string;
    readonly fingerprint: string;
  },
): Promise<IdempotencyClaim> {
  const inserted = await transaction.authoringIdempotency.createMany({
    data: {
      actorId: values.actor,
      operation: values.operation,
      idempotencyKey: values.key,
      requestFingerprint: values.fingerprint,
    },
    skipDuplicates: true,
  });
  if (inserted.count === 1) {
    return { kind: "claimed" };
  }

  const existing = await transaction.authoringIdempotency.findUniqueOrThrow({
    where: {
      actorId_operation_idempotencyKey: {
        actorId: values.actor,
        operation: values.operation,
        idempotencyKey: values.key,
      },
    },
    select: {
      requestFingerprint: true,
      materialId: true,
      revisionId: true,
      publicationEventId: true,
    },
  });

  if (existing.requestFingerprint.trim() !== values.fingerprint) {
    return { kind: "reused" };
  }
  if (existing.materialId === null || existing.revisionId === null) {
    return { kind: "incomplete" };
  }
  return {
    kind: "replay",
    materialId: existing.materialId,
    revisionId: existing.revisionId,
    publicationEventId: existing.publicationEventId,
  };
}

export async function completeIdempotency(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly actor: string;
    readonly operation: AuthoringOperation;
    readonly key: string;
    readonly materialId: string;
    readonly publicationEventId?: string;
    readonly revisionId: string;
  },
): Promise<void> {
  await transaction.authoringIdempotency.update({
    where: {
      actorId_operation_idempotencyKey: {
        actorId: values.actor,
        operation: values.operation,
        idempotencyKey: values.key,
      },
    },
    data: {
      materialId: values.materialId,
      publicationEventId: values.publicationEventId ?? null,
      revisionId: values.revisionId,
    },
  });
}
