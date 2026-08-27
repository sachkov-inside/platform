import { z } from "zod";

import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";
import type { MaterialMutationReceiptDto } from "../../facets/material-authoring/material-authoring.contract.js";

export type AuthoringOperation =
  | "create_draft"
  | "save_material"
  | "delete_draft";

export type IdempotencyEffect =
  | { readonly kind: "material"; readonly receipt: MaterialMutationReceiptDto }
  | { readonly kind: "deleted"; readonly materialId: string };

export type IdempotencyClaim =
  | { readonly kind: "claimed" }
  | { readonly kind: "replay"; readonly effect: IdempotencyEffect }
  | { readonly kind: "reused" }
  | { readonly kind: "incomplete" };

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);

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
      contentVersion: true,
      publicationState: true,
      publishedAt: true,
      deleted: true,
    },
  });

  if (existing.requestFingerprint.trim() !== values.fingerprint) {
    return { kind: "reused" };
  }
  if (existing.materialId === null) {
    return { kind: "incomplete" };
  }
  if (existing.deleted) {
    return {
      kind: "replay",
      effect: { kind: "deleted", materialId: existing.materialId },
    };
  }
  if (
    existing.contentVersion === null ||
    existing.publicationState === null
  ) {
    return { kind: "incomplete" };
  }
  const publicationState = publicationStateSchema.safeParse(
    existing.publicationState,
  );
  const contentVersion = Number(existing.contentVersion);
  if (!publicationState.success || !Number.isSafeInteger(contentVersion)) {
    return { kind: "incomplete" };
  }
  return {
    kind: "replay",
    effect: {
      kind: "material",
      receipt: {
        materialId: existing.materialId,
        contentVersion,
        publicationState: publicationState.data,
        publishedAt: existing.publishedAt?.toISOString() ?? null,
      },
    },
  };
}

export async function completeIdempotency(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly actor: string;
    readonly operation: AuthoringOperation;
    readonly key: string;
    readonly effect: IdempotencyEffect;
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
    data:
      values.effect.kind === "deleted"
        ? {
            materialId: values.effect.materialId,
            deleted: true,
          }
        : {
            materialId: values.effect.receipt.materialId,
            contentVersion: BigInt(values.effect.receipt.contentVersion),
            publicationState: values.effect.receipt.publicationState,
            publishedAt:
              values.effect.receipt.publishedAt === null
                ? null
                : new Date(values.effect.receipt.publishedAt),
            deleted: false,
          },
  });
}
