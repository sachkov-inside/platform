import { randomUUID } from "node:crypto";

import type { MaterialBodyOperations } from "../domain/material-body/material-body.js";
import type { MaterialRevision } from "../domain/material.js";
import {
  materialId,
  materialRevisionId,
  type MaterialId,
  type MaterialRevisionId,
} from "../domain/material-identifiers.js";
import type { MaterialsPrismaTransaction } from "../../../infrastructure/prisma/index.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../infrastructure/postgres/idempotency.js";
import { loadMaterialRevision } from "../infrastructure/postgres/material-revision-reader.js";
import type {
  IdempotencyError,
  SystemError,
} from "../facets/material-authoring/material-authoring.contract.js";
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

export interface PublicationEvent {
  readonly id: string;
  readonly materialId: MaterialId;
  readonly revisionId: MaterialRevisionId;
  readonly createdAt: Date;
}

function internalError(): Extract<SystemError, { readonly code: "internal_error" }> {
  return { code: "internal_error", correlationId: randomUUID() };
}

export async function executeIdempotentRevision(
  transaction: MaterialsPrismaTransaction,
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
  transaction: MaterialsPrismaTransaction,
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
    const event = await transaction.materialPublicationEvent.findUnique({
      where: { id: claim.publicationEventId },
      select: {
        id: true,
        materialId: true,
        revisionId: true,
        createdAt: true,
      },
    });
    if (event === null) {
      rollback(internalError());
    }
    return {
      id: event.id,
      materialId: materialId(event.materialId),
      revisionId: materialRevisionId(event.revisionId),
      createdAt: event.createdAt,
    };
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
