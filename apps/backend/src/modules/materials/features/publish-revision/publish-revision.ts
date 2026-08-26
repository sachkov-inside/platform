import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  PublishRevisionError,
  PublishRevisionOperation,
} from "./publish-revision.contract.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
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
import { mapPostgresLifecycleError } from "../../shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../../shared/reference-integrity.js";
import {
  executeIdempotentPublication,
  type PublicationEvent,
} from "../../shared/idempotent-operation.js";
import { lockMaterialForLifecycleChange } from "../../infrastructure/postgres/material-locks.js";
import { loadMaterialRevision } from "../../infrastructure/postgres/material-revision-reader.js";
import type { MaterialRevisionMetadata } from "../../domain/material-revision-metadata.js";
import type { MaterialBodyExtraction } from "../../domain/material-body/material-body.js";
import type { MaterialRevision } from "../../domain/material.js";
import {
  materialId,
  materialRevisionId,
} from "../../domain/material-identifiers.js";
import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";

const publishRevisionCommand = z
  .object({
    actor: accountId,
    idempotencyKey: idempotencyKeySchema,
    materialId: materialIdSchema,
    revisionId: materialRevisionIdSchema,
    expectedPublishedRevisionId: materialRevisionIdSchema.nullable(),
  })
  .strict();

interface Dependencies {
  readonly prisma: MaterialsPrismaClient;
  readonly materialBodyOperations: MaterialBodyOperations;
  readonly authorPolicy: AuthorPolicy;
}

export function assemblePublishRevision(
  dependencies: Dependencies,
): PublishRevisionOperation {
  return async (input) => {
    const parsed = parseCommand(publishRevisionCommand, input);
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
    const fingerprint = fingerprintCommand({ operation: "publish_revision", ...command });
    let publicationMetadata: MaterialRevisionMetadata | undefined;
    const result = await executeAuthoringTransaction<
      PublicationEvent,
      PublishRevisionError
    >(
      dependencies.prisma,
      (transaction, rollback) =>
        executeIdempotentPublication(
          transaction,
          {
            actor: command.actor,
            operation: "publish_revision",
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
            const revision = await loadMaterialRevision(
              transaction,
              dependencies.materialBodyOperations,
              command.materialId,
              command.revisionId,
            );
            if (revision === undefined) {
              return rollback({ code: "revision_not_found" });
            }
            if (!revision.ok) {
              return rollback({
                code: "internal_error",
                correlationId: randomUUID(),
              });
            }
            const transition = material.publishRevision(
              command.revisionId,
              command.expectedPublishedRevisionId,
            );
            if (!transition.ok) {
              return rollback(transition.error);
            }
            publicationMetadata = revision.value.metadata;
            await requireReferenceIntegrity(
              transaction,
              command.materialId,
              revision.value.metadata,
              rollback,
            );
            const extraction = dependencies.materialBodyOperations.extract(
              revision.value.body,
            );
            if (!extraction.ok) {
              return rollback(extraction.error);
            }
            return publishRevision(transaction, {
              actor: command.actor,
              eventId: randomUUID(),
              extraction: extraction.value,
              revision: revision.value,
            });
          },
        ),
      (unexpected) =>
        mapPostgresLifecycleError(unexpected, publicationMetadata),
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

async function publishRevision(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly actor: string;
    readonly eventId: string;
    readonly extraction: MaterialBodyExtraction;
    readonly revision: MaterialRevision;
  },
): Promise<PublicationEvent> {
  const { metadata } = values.revision;
  const event = await transaction.materialPublicationEvent.create({
    data: {
      id: values.eventId,
      materialId: values.revision.materialId,
      revisionId: values.revision.id,
      kind: "publish",
      actorId: values.actor,
    },
    select: { id: true, materialId: true, revisionId: true, createdAt: true },
  });

  await transaction.material.update({
    where: { id: values.revision.materialId },
    data: { currentPublishedRevisionId: values.revision.id },
  });
  await transaction.materialSearchDocument.deleteMany({
    where: { materialId: values.revision.materialId },
  });
  await transaction.publishedMaterial.upsert({
    where: { materialId: values.revision.materialId },
    create: {
      materialId: values.revision.materialId,
      revisionId: values.revision.id,
      slug: metadata.slug,
      title: metadata.title,
      summary: metadata.summary,
      access: metadata.access,
      topicId: metadata.topicId,
      formatId: metadata.formatId,
      publishedBy: values.actor,
      publishedAt: event.createdAt,
    },
    update: {
      revisionId: values.revision.id,
      slug: metadata.slug,
      title: metadata.title,
      summary: metadata.summary,
      access: metadata.access,
      topicId: metadata.topicId,
      formatId: metadata.formatId,
      publishedBy: values.actor,
      publishedAt: event.createdAt,
    },
  });
  await transaction.publishedMaterialTag.deleteMany({
    where: { materialId: values.revision.materialId },
  });
  if (metadata.tagIds.length > 0) {
    await transaction.publishedMaterialTag.createMany({
      data: metadata.tagIds.map((tagId) => ({
        materialId: values.revision.materialId,
        tagId,
      })),
    });
  }
  await transaction.publishedMaterialSeriesMembership.deleteMany({
    where: { materialId: values.revision.materialId },
  });
  if (metadata.seriesMemberships.length > 0) {
    await transaction.publishedMaterialSeriesMembership.createMany({
      data: metadata.seriesMemberships.map(({ ordinal, seriesId }) => ({
        materialId: values.revision.materialId,
        ordinal,
        seriesId,
      })),
    });
  }
  await transaction.materialSearchDocument.upsert({
    where: { materialId: values.revision.materialId },
    create: {
      materialId: values.revision.materialId,
      revisionId: values.revision.id,
      plainText: values.extraction.plainText,
    },
    update: {
      revisionId: values.revision.id,
      plainText: values.extraction.plainText,
    },
  });

  return {
    id: event.id,
    materialId: materialId(event.materialId),
    revisionId: materialRevisionId(event.revisionId),
    createdAt: event.createdAt,
  };
}
