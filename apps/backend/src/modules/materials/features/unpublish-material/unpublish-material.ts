import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  UnpublishMaterialError,
  UnpublishMaterialOperation,
} from "./unpublish-material.contract.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { authorizeManager, type AuthorPolicy } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import {
  idempotencyKeySchema,
  materialIdSchema,
  materialRevisionIdSchema,
  parseCommand,
  accountId,
} from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import {
  executeIdempotentPublication,
  type PublicationEvent,
} from "../../shared/idempotent-operation.js";
import { lockMaterialForLifecycleChange } from "../../infrastructure/postgres/material-locks.js";
import {
  materialId,
  materialRevisionId,
  type MaterialId,
  type MaterialRevisionId,
} from "../../domain/material-identifiers.js";
import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";

const unpublishMaterialCommand = z
  .object({
    actor: accountId,
    idempotencyKey: idempotencyKeySchema,
    materialId: materialIdSchema,
    expectedPublishedRevisionId: materialRevisionIdSchema,
  })
  .strict();

interface Dependencies {
  readonly prisma: MaterialsPrismaClient;
  readonly authorPolicy: AuthorPolicy;
}

export function assembleUnpublishMaterial(
  dependencies: Dependencies,
): UnpublishMaterialOperation {
  return async (input) => {
    const parsed = parseCommand(unpublishMaterialCommand, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const command = parsed.value;
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }
    const fingerprint = fingerprintCommand({ operation: "unpublish_material", ...command });
    const result = await executeAuthoringTransaction<
      PublicationEvent,
      UnpublishMaterialError
    >(
      dependencies.prisma,
      (transaction, rollback) =>
        executeIdempotentPublication(
          transaction,
          {
            actor: command.actor,
            operation: "unpublish_material",
            key: command.idempotencyKey,
            fingerprint,
          },
          rollback,
          async () => {
            const material = await lockMaterialForLifecycleChange(
              transaction,
              command.materialId,
            );
            if (material === undefined) {
              return rollback({ code: "material_not_found" });
            }
            if (material.currentPublishedRevisionId === null) {
              const hadPriorPublication =
                (await transaction.materialPublicationEvent.findFirst({
                  where: {
                    materialId: command.materialId,
                    revisionId: command.expectedPublishedRevisionId,
                    kind: "publish",
                  },
                  select: { id: true },
                })) !== null;
              if (!hadPriorPublication) {
                return rollback({ code: "publication_not_found" });
              }
            }
            const transition = material.unpublish(
              command.expectedPublishedRevisionId,
            );
            if (!transition.ok) {
              return rollback(transition.error);
            }
            return unpublishMaterial(transaction, {
              actor: command.actor,
              eventId: randomUUID(),
              materialId: command.materialId,
              revisionId: command.expectedPublishedRevisionId,
            });
          },
        ),
      mapPostgresReadError,
    );
    return result.ok
      ? {
        ok: true,
        value: {
          materialId: result.value.materialId,
          revisionId: result.value.revisionId,
          publicationEventId: result.value.id,
          recordedAt: result.value.createdAt,
        },
      }
      : result;
  };
}

async function unpublishMaterial(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly actor: string;
    readonly eventId: string;
    readonly materialId: MaterialId;
    readonly revisionId: MaterialRevisionId;
  },
): Promise<PublicationEvent> {
  const event = await transaction.materialPublicationEvent.create({
    data: {
      id: values.eventId,
      materialId: values.materialId,
      revisionId: values.revisionId,
      kind: "unpublish",
      actorId: values.actor,
    },
    select: { id: true, materialId: true, revisionId: true, createdAt: true },
  });
  await transaction.material.update({
    where: { id: values.materialId },
    data: { currentPublishedRevisionId: null },
  });
  await transaction.publishedMaterial.delete({
    where: { materialId: values.materialId },
  });
  return {
    id: event.id,
    materialId: materialId(event.materialId),
    revisionId: materialRevisionId(event.revisionId),
    createdAt: event.createdAt,
  };
}
