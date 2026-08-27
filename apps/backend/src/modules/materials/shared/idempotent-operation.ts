import { randomUUID } from "node:crypto";

import type { MaterialsPrismaTransaction } from "../../../infrastructure/prisma/index.js";
import {
  claimIdempotency,
  completeIdempotency,
  type AuthoringOperation,
  type IdempotencyEffect,
} from "../infrastructure/postgres/idempotency.js";
import type {
  IdempotencyError,
  SystemError,
} from "../facets/material-authoring/material-authoring.contract.js";
import type { Rollback } from "./application-result.js";

type IdempotentOperationError = IdempotencyError | SystemError;

export async function executeIdempotentMaterialMutation<
  Effect extends IdempotencyEffect,
>(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly actor: string;
    readonly operation: AuthoringOperation;
    readonly key: string;
    readonly fingerprint: string;
    readonly effectKind: Effect["kind"];
  },
  rollback: Rollback<IdempotentOperationError>,
  mutate: () => Promise<Effect>,
): Promise<Effect> {
  const claim = await claimIdempotency(transaction, values);
  if (claim.kind === "reused") {
    rollback({ code: "idempotency_key_reused" });
  }
  if (claim.kind === "incomplete") {
    rollback(internalError());
  }
  if (claim.kind === "replay") {
    if (claim.effect.kind !== values.effectKind) {
      rollback(internalError());
    }
    // The discriminant check above proves the operation-specific effect kind.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return claim.effect as Effect;
  }

  const effect = await mutate();
  await completeIdempotency(transaction, {
    actor: values.actor,
    operation: values.operation,
    key: values.key,
    effect,
  });
  return effect;
}

function internalError(): Extract<
  SystemError,
  { readonly code: "internal_error" }
> {
  return { code: "internal_error", correlationId: randomUUID() };
}
