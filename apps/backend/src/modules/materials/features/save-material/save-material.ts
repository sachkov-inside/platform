import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";

import type {
  SaveMaterialError,
  SaveMaterialOperation,
} from "./save-material.contract.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import type { MaterialMutationReceiptDto } from "../../facets/material-authoring/material-authoring.contract.js";
import {
  MaterialMetadataSelection,
  type MaterialMetadata,
} from "../../domain/material-metadata.js";
import { authorizeManager } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import {
  accountId,
  idempotencyKeySchema,
  materialIdSchema,
  parseCommand,
} from "../../shared/command-validation.js";
import { executeIdempotentMaterialMutation } from "../../shared/idempotent-operation.js";
import { materializeMetadataSelection } from "../../shared/materialize-metadata-selection.js";
import { mapPostgresError } from "../../shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../../shared/reference-integrity.js";
import { toDatabaseJson } from "../../infrastructure/postgres/database-json.js";
import { lockMaterialForLifecycleChange } from "../../infrastructure/postgres/material-locks.js";
import { replaceCurrentRelations } from "../../infrastructure/postgres/current-material.js";
import { lockMaterialSeries } from "../../infrastructure/postgres/series-order.js";

const saveMaterialCommand = z
  .object({
    actor: accountId,
    idempotencyKey: idempotencyKeySchema,
    materialId: materialIdSchema,
    expectedContentVersion: z.number().int().positive(),
    publicationState: z.enum(["draft", "published", "unpublished"]),
    metadata: z.unknown(),
    body: z.unknown(),
  })
  .strict();

type SaveMaterialEffect = {
  readonly kind: "material";
  readonly receipt: MaterialMutationReceiptDto;
};

export function assembleSaveMaterial(
  dependencies: MaterialAuthoringDependencies,
): SaveMaterialOperation {
  return async (input) => {
    const parsed = parseCommand(saveMaterialCommand, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const command = parsed.value;
    const selection = MaterialMetadataSelection.create(command.metadata);
    if (!selection.ok) {
      return failure(selection.error);
    }
    const body = dependencies.materialBodyOperations.accept(command.body, {
      assignMissingNodeIds: true,
    });
    if (!body.ok) {
      return failure(body.error);
    }
    const extraction = dependencies.materialBodyOperations.extract(body.value);
    if (!extraction.ok) {
      return failure(extraction.error);
    }
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }

    const fingerprint = fingerprintCommand({
      operation: "save_material",
      materialId: command.materialId,
      expectedContentVersion: command.expectedContentVersion,
      publicationState: command.publicationState,
      metadata: selection.value.toValues(),
      body: body.value,
    });
    let materializedMetadata: MaterialMetadata | undefined;
    const result = await executeAuthoringTransaction<
      SaveMaterialEffect,
      SaveMaterialError
    >(
      dependencies.prisma,
      (transaction, rollback) =>
        executeIdempotentMaterialMutation<SaveMaterialEffect>(
          transaction,
          {
            actor: command.actor,
            operation: "save_material",
            key: command.idempotencyKey,
            fingerprint,
            effectKind: "material",
          },
          rollback,
          async () => {
            await lockMaterialSeries(
              transaction,
              command.materialId,
              selection.value.toValues().seriesIds,
            );
            const locked = await lockMaterialForLifecycleChange(
              transaction,
              command.materialId,
            );
            if (locked === undefined) {
              return rollback({ code: "material_not_found" });
            }
            const next = locked.lifecycle.save({
              expectedContentVersion: command.expectedContentVersion,
              publicationState: command.publicationState,
              slug: selection.value.toValues().slug,
              now: new Date(),
            });
            if (!next.ok) {
              return rollback(next.error);
            }
            materializedMetadata = await materializeMetadataSelection(
              transaction,
              command.materialId,
              selection.value,
            );
            const requiresPublicationValidity =
              locked.lifecycle.publicationState === "published" ||
              next.value.publicationState === "published";
            const publishable = materializedMetadata.validateForPublication();
            if (requiresPublicationValidity && !publishable.ok) {
              return rollback(publishable.error);
            }
            await requireReferenceIntegrity(
              transaction,
              command.materialId,
              materializedMetadata,
              rollback,
            );

            const entersPublished =
              locked.lifecycle.publicationState !== "published" &&
              next.value.publicationState === "published";
            const publishedBy = entersPublished
              ? command.actor
              : locked.publishedBy;
            await transaction.material.update({
              where: { id: command.materialId },
              data: {
                slug: materializedMetadata.slug,
                title: materializedMetadata.title,
                summary: materializedMetadata.summary,
                topicId: materializedMetadata.topicId,
                formatId: materializedMetadata.formatId,
                schemaVersion: body.value.schemaVersion,
                body: toDatabaseJson(body.value.doc),
                access: materializedMetadata.access,
                publicationState: next.value.publicationState,
                contentVersion: BigInt(next.value.contentVersion),
                firstPublishedAt: next.value.firstPublishedAt,
                publishedAt: next.value.publishedAt,
                publishedBy,
                updatedAt: new Date(),
              },
            });
            await replaceCurrentRelations(
              transaction,
              command.materialId,
              materializedMetadata,
            );
            if (next.value.publicationState === "published") {
              if (!publishable.ok || publishedBy === null) {
                return rollback({
                  code: "internal_error",
                  correlationId: randomUUID(),
                });
              }
              await replacePublishedProjections(transaction, {
                materialId: command.materialId,
                contentVersion: next.value.contentVersion,
                metadata: publishable.value,
                publishedAt: requireDate(next.value.publishedAt),
                publishedBy,
                plainText: extraction.value.plainText,
              });
            } else {
              await transaction.publishedMaterial.deleteMany({
                where: { materialId: command.materialId },
              });
              await transaction.materialSearchDocument.deleteMany({
                where: { materialId: command.materialId },
              });
            }
            return {
              kind: "material",
              receipt: {
                materialId: command.materialId,
                contentVersion: next.value.contentVersion,
                publicationState: next.value.publicationState,
                publishedAt: next.value.publishedAt?.toISOString() ?? null,
              },
            };
          },
        ),
      (unexpected) => mapPostgresError(unexpected, materializedMetadata),
    );
    return result.ok ? { ok: true, value: result.value.receipt } : result;
  };
}

async function replacePublishedProjections(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly materialId: string;
    readonly contentVersion: number;
    readonly metadata: {
      readonly access: "free" | "membership";
      readonly formatId: string;
      readonly seriesMemberships: readonly {
        readonly seriesId: string;
        readonly ordinal: number;
      }[];
      readonly slug: string;
      readonly summary: string;
      readonly tagIds: readonly string[];
      readonly title: string;
      readonly topicId: string;
    };
    readonly publishedAt: Date;
    readonly publishedBy: string;
    readonly plainText: string;
  },
): Promise<void> {
  await transaction.publishedMaterial.upsert({
    where: { materialId: values.materialId },
    create: {
      materialId: values.materialId,
      contentVersion: BigInt(values.contentVersion),
      slug: values.metadata.slug,
      title: values.metadata.title,
      summary: values.metadata.summary,
      access: values.metadata.access,
      topicId: values.metadata.topicId,
      formatId: values.metadata.formatId,
      publishedBy: values.publishedBy,
      publishedAt: values.publishedAt,
    },
    update: {
      contentVersion: BigInt(values.contentVersion),
      slug: values.metadata.slug,
      title: values.metadata.title,
      summary: values.metadata.summary,
      access: values.metadata.access,
      topicId: values.metadata.topicId,
      formatId: values.metadata.formatId,
      publishedBy: values.publishedBy,
      publishedAt: values.publishedAt,
    },
  });
  await transaction.publishedMaterialTag.deleteMany({
    where: { materialId: values.materialId },
  });
  if (values.metadata.tagIds.length > 0) {
    await transaction.publishedMaterialTag.createMany({
      data: values.metadata.tagIds.map((tagId) => ({
        materialId: values.materialId,
        tagId,
      })),
    });
  }
  await transaction.publishedMaterialSeriesMembership.deleteMany({
    where: { materialId: values.materialId },
  });
  if (values.metadata.seriesMemberships.length > 0) {
    await transaction.publishedMaterialSeriesMembership.createMany({
      data: values.metadata.seriesMemberships.map(({ seriesId, ordinal }) => ({
        materialId: values.materialId,
        seriesId,
        ordinal,
      })),
    });
  }
  await transaction.materialSearchDocument.upsert({
    where: { materialId: values.materialId },
    create: {
      materialId: values.materialId,
      contentVersion: BigInt(values.contentVersion),
      plainText: values.plainText,
    },
    update: {
      contentVersion: BigInt(values.contentVersion),
      plainText: values.plainText,
    },
  });
}

function requireDate(value: Date | null): Date {
  if (value === null) {
    throw new TypeError("Published Material requires publishedAt");
  }
  return value;
}
