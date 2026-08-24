import { randomUUID } from "node:crypto";

import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import type { MaterialRevision } from "../../domain/material.js";
import {
  materialId,
  materialRevisionId,
} from "../../domain/material-identifiers.js";
import type { AuthoringTransaction } from "../../infrastructure/postgres/database.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../../infrastructure/postgres/idempotency.js";
import {
  loadPublicationEvent,
  type PublicationEvent,
} from "../../infrastructure/postgres/lifecycle-persistence.js";
import { loadMaterialRevision } from "../../infrastructure/postgres/material-persistence.js";
import type {
  IdempotencyError,
  SystemError,
} from "../material-authoring.interface.js";
import type { Rollback } from "./application-result.js";

type IdempotentOperationError = IdempotencyError | SystemError;

interface IdempotentOperation<Operation extends string> {
  readonly actor: string;
  readonly operation: Operation;
  readonly key: string;
  readonly fingerprint: string;
}

type RevisionOperation =
  | "create_draft"
  | "restore_revision"
  | "revise_draft";

type PublicationOperation = "publish_revision" | "unpublish_material";

function internalError(): Extract<SystemError, { readonly code: "internal_error" }> {
  return { code: "internal_error", correlationId: randomUUID() };
}

export async function executeIdempotentRevision(
  transaction: AuthoringTransaction,
  materialBodyOperations: MaterialBodyOperations,
  values: IdempotentOperation<RevisionOperation>,
  rollback: Rollback<IdempotentOperationError>,
  effect: () => Promise<MaterialRevision>,
): Promise<MaterialRevision> {
  const claim = await claimIdempotency(transaction, values);
  if (claim.kind === "reused") {
    rollback({ code: "idempotency_key_reused" });
  }
  if (claim.kind === "incomplete") {
    rollback(internalError());
  }
  if (claim.kind === "replay") {
    const revision = await loadMaterialRevision(
      transaction,
      materialBodyOperations,
      materialId(claim.materialId),
      materialRevisionId(claim.revisionId),
    );
    if (revision === undefined || !revision.ok) {
      rollback(internalError());
    }
    return revision.value;
  }

  const revision = await effect();
  await completeIdempotency(transaction, {
    actor: values.actor,
    operation: values.operation,
    key: values.key,
    materialId: revision.materialId,
    revisionId: revision.id,
  });
  return revision;
}

export async function executeIdempotentPublication(
  transaction: AuthoringTransaction,
  values: IdempotentOperation<PublicationOperation>,
  rollback: Rollback<IdempotentOperationError>,
  effect: () => Promise<PublicationEvent>,
): Promise<PublicationEvent> {
  const claim = await claimIdempotency(transaction, values);
  if (claim.kind === "reused") {
    rollback({ code: "idempotency_key_reused" });
  }
  if (claim.kind === "incomplete") {
    rollback(internalError());
  }
  if (claim.kind === "replay") {
    if (claim.publicationEventId === null) {
      rollback(internalError());
    }
    const event = await loadPublicationEvent(
      transaction,
      claim.publicationEventId,
    );
    if (event === undefined) {
      rollback(internalError());
    }
    return event;
  }

  const event = await effect();
  await completeIdempotency(transaction, {
    actor: values.actor,
    operation: values.operation,
    key: values.key,
    materialId: event.materialId,
    revisionId: event.revisionId,
    publicationEventId: event.id,
  });
  return event;
}
