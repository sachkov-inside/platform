import { videoChaptersSchema } from "../../domain/video-chapters.js";
import type { AuthoringSource } from "../../domain/authoring-source.js";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  type MaterialsPrismaTransaction,
  lockMaterialReferenceChanges,
} from "../../../../infrastructure/prisma/index.js";

import {
  MATERIAL_DETACHED_VIDEOS_MAX,
  type SaveMaterialError,
  type SaveMaterialOperation,
} from "./save-material.contract.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import type { MaterialMutationReceiptDto } from "../../facets/material-authoring/material-authoring.contract.js";
import {
  MaterialMetadataSelection,
  type MaterialDifficulty,
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
import { canChangeGuideMemberships } from "../../infrastructure/postgres/source-guide-memberships.js";
import { mapPostgresError } from "../../shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../../shared/reference-integrity.js";
import { toDatabaseJson } from "../../infrastructure/postgres/database-json.js";
import {
  recordVideoDetachment,
  requestVideoDeletion,
} from "../../../videos/index.js";
import { markUnreferencedMaterialAssets } from "../../../assets/index.js";
import { materialReaderPath } from "../../domain/announcement.js";
import { recordMaterialAnnouncement } from "./record-announcement.js";
import { lockMaterialForLifecycleChange } from "../../infrastructure/postgres/material-locks.js";
import { allocateMaterialSlug } from "../../infrastructure/postgres/material-slug.js";
import { replaceCurrentRelations } from "../../infrastructure/postgres/current-material.js";
import { lockMaterialSeries } from "../../infrastructure/postgres/series-order.js";
import { refreshPublishedMaterialSearchProjections } from "../../infrastructure/postgres/published-material-search.js";
import {
  heldGuideRemovals,
  recordGuideRemovals,
  unconfirmedGuideRemovals,
} from "../../shared/guide-removal-confirmation.js";

const saveMaterialCommand = z
  .object({
    actor: accountId,
    idempotencyKey: idempotencyKeySchema,
    materialId: materialIdSchema,
    expectedContentVersion: z.number().int().positive(),
    publicationState: z.enum(["draft", "published", "unpublished"]),
    primaryVideoId: z.uuid().nullable().optional().default(null),
    deleteVideoId: z.uuid().nullable().optional().default(null),
    detachVideoIds: z
      .array(z.uuid())
      .max(MATERIAL_DETACHED_VIDEOS_MAX)
      .optional()
      .default([]),
    metadata: z.unknown(),
    body: z.unknown(),
    videoChapters: videoChaptersSchema.optional(),
    confirmedGuideRemovals: z.array(z.uuid()).max(100).optional().default([]),
  })
  .strict();

type SaveMaterialEffect = {
  readonly kind: "material";
  readonly receipt: MaterialMutationReceiptDto;
};

export function assembleSaveMaterial(
  dependencies: MaterialAuthoringDependencies,
  source?: AuthoringSource,
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
    const assetReferences = extraction.value.resources.map((resource) => ({
      assetId: resource.assetId,
      kind: resource.kind,
    }));
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }

    const fingerprint = fingerprintCommand({
      operation: "save_material",
      source: source ?? null,
      materialId: command.materialId,
      expectedContentVersion: command.expectedContentVersion,
      publicationState: command.publicationState,
      metadata: selection.value.toValues(),
      body: body.value,
      primaryVideoId: command.primaryVideoId,
      deleteVideoId: command.deleteVideoId,
      videoChapters: command.videoChapters ?? null,
      confirmedGuideRemovals: [...command.confirmedGuideRemovals].sort(),
      // Absent when empty, so a Save recorded before detachment existed replays with its own key.
      ...(command.detachVideoIds.length === 0
        ? {}
        : { detachVideoIds: command.detachVideoIds }),
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
            if (!await canChangeGuideMemberships(transaction, command.materialId, selection.value.toValues().seriesIds, source?.id ?? null)) {
              return rollback({ code: "forbidden" });
            }
            await lockMaterialReferenceChanges(transaction, [command.materialId]);
            const locked = await lockMaterialForLifecycleChange(
              transaction,
              command.materialId,
            );
            if (locked === undefined) {
              return rollback({ code: "material_not_found" });
            }
            if (locked.sourceId !== (source?.id ?? null)) {
              return rollback({
                code: "invalid_reference",
                issues: [{ code: "authoring_source_required", path: "/materialId" }],
              });
            }
            if (source !== undefined && command.deleteVideoId !== null) {
              return rollback({
                code: "invalid_reference",
                issues: [{ code: "import_video_deletion_forbidden", path: "/deleteVideoId" }],
              });
            }
            if (
              command.deleteVideoId !== null &&
              command.primaryVideoId === command.deleteVideoId
            ) {
              return rollback({
                code: "invalid_reference",
                issues: [{ code: "video_deletion_target_mismatch", path: "/deleteVideoId" }],
              });
            }
            const videoChapters = command.videoChapters ?? (command.primaryVideoId === locked.primaryVideoId ? locked.videoChapters : []);
            if (videoChapters.length > 0) {
              if (command.primaryVideoId === null || dependencies.videos === undefined) return rollback({ code: "invalid_reference", issues: [{ code: "video_chapters_require_video", path: "/videoChapters" }] });
              const video = await dependencies.videos.loadAuthoringPresentation({ materialId: command.materialId, videoId: command.primaryVideoId });
              if (!video.ok) return rollback({ code: "dependency_unavailable", retryable: true });
              const duration = video.value?.durationSeconds;
              if (duration === undefined || videoChapters.some((chapter) => chapter.start >= duration)) return rollback({ code: "invalid_reference", issues: [{ code: "video_chapter_outside_duration", path: "/videoChapters" }] });
            }
            if (
              command.primaryVideoId !== null &&
              command.detachVideoIds.includes(command.primaryVideoId)
            ) {
              return rollback({
                code: "invalid_reference",
                issues: [{ code: "video_detachment_target_mismatch", path: "/detachVideoIds" }],
              });
            }
            const selectedValues = selection.value.toValues();
            if (
              locked.access === "workshop" &&
              selectedValues.access !== "workshop"
            ) {
              const protection =
                await dependencies.workshopMaterialProtection?.resolve(
                  command.materialId,
                ) ?? "unavailable";
              if (protection === "unavailable") {
                return rollback({
                  code: "dependency_unavailable",
                  retryable: true,
                });
              }
              if (protection === "protected") {
                return rollback({
                  code: "invalid_reference",
                  issues: [
                    {
                      code: "workshop_material_access_change_forbidden",
                      path: "/metadata/access",
                    },
                  ],
                });
              }
            }
            const slug =
              locked.lifecycle.slug ??
              (command.publicationState === "published" && selectedValues.title !== null
                ? await allocateMaterialSlug(transaction, selectedValues.title)
                : null);
            const savedAt = new Date();
            const next = locked.lifecycle.save({
              expectedContentVersion: command.expectedContentVersion,
              publicationState: command.publicationState,
              slug,
              now: savedAt,
            });
            if (!next.ok) {
              return rollback(next.error);
            }
            materializedMetadata = await materializeMetadataSelection(
              transaction,
              command.materialId,
              selection.value,
              slug,
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
            if (dependencies.materialAssets !== undefined) {
              const assetIssues = await dependencies.materialAssets.inspectReferences(
                command.materialId,
                assetReferences,
              );
              if (!assetIssues.ok) return rollback(assetIssues.error);
              if (assetIssues.value.length > 0) {
                return rollback({
                  code: "invalid_reference",
                  issues: assetIssues.value.map((issue) => ({
                    code: issue.code,
                    path: "/body",
                  })),
                });
              }
            }
            if (command.primaryVideoId !== null) {
              if (dependencies.videos === undefined) {
                return rollback({ code: "dependency_unavailable", retryable: true });
              }
              const videoReference = await dependencies.videos.inspectPrimaryReference({
                access: materializedMetadata.access,
                materialId: command.materialId,
                videoId: command.primaryVideoId,
              });
              if (!videoReference.ok) {
                if (videoReference.error.code === "dependency_unavailable") {
                  return rollback(videoReference.error);
                }
                const code = videoReference.error.code === "video_not_found"
                  ? "video_not_found"
                  : videoReference.error.code === "video_not_ready"
                    ? "video_not_ready"
                    : "video_provider_mismatch";
                return rollback({
                  code: "invalid_reference",
                  issues: [{ code, path: "/primaryVideoId" }],
                });
              }
            }

            // Опубликованный материал уходит из руководства, где у кого-то есть право, только
            // подтверждённым снятием: иначе купившие молча потеряли бы часть продукта.
            const previousGuideIds = (await transaction.publishedMaterialGuideMembership.findMany({
              where: { materialId: command.materialId },
              select: { seriesId: true },
            })).map(({ seriesId }) => seriesId);
            const nextGuideIds = next.value.publicationState === "published" ? selectedValues.seriesIds : [];
            const heldRemovals = await heldGuideRemovals(
              transaction,
              dependencies.guideAccessHolders,
              previousGuideIds.filter((guideId) => !nextGuideIds.includes(guideId)),
            );
            const unconfirmed = unconfirmedGuideRemovals(heldRemovals, command.confirmedGuideRemovals);
            if (unconfirmed.length > 0) {
              return rollback({ code: "guide_removal_confirmation_required", guides: unconfirmed });
            }
            await recordGuideRemovals(transaction, {
              actor: command.actor,
              operation: "material_save",
              removals: heldRemovals.map((guide) => ({ guide, materialId: command.materialId })),
              removedAt: savedAt,
            });

            const entersPublished =
              locked.lifecycle.publicationState !== "published" &&
              next.value.publicationState === "published";
            const publishedBy = entersPublished
              ? command.actor
              : locked.publishedBy;
            await transaction.material.update({
              where: { id: command.materialId },
              data: {
                ...(source === undefined ? {} : { sourcePath: source.path, sourceRevision: source.revision, showInFeed: source.showInFeed }),
                slug: materializedMetadata.slug,
                title: materializedMetadata.title,
                summary: materializedMetadata.summary,
                difficulty: materializedMetadata.difficulty,
                outcomes: [...materializedMetadata.outcomes],
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
                primaryVideoId: command.primaryVideoId,
                videoChapters: toDatabaseJson([...videoChapters]),
                coverId: locked.coverId,
                updatedAt: savedAt,
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
                publishedAt: requireDate(next.value.publishedAt, "publishedAt"),
                publishedBy,
                hasModeVariants: extraction.value.hasModeVariants,
                plainText: extraction.value.plainText,
                primaryVideoId: command.primaryVideoId,
                coverId: locked.coverId,
              });
              // Первая публикация обещает уведомление в той же транзакции, что и сам факт.
              await recordMaterialAnnouncement(
                transaction,
                {
                  occurrence: {
                    materialId: command.materialId,
                    firstPublishedAt: requireDate(
                      next.value.firstPublishedAt,
                      "firstPublishedAt",
                    ),
                    title: publishable.value.title,
                    readerPath: materialReaderPath(publishable.value.slug),
                  },
                  firstPublication: locked.lifecycle.firstPublishedAt === null,
                },
                savedAt,
              );
            } else {
              await transaction.publishedMaterial.deleteMany({
                where: { materialId: command.materialId },
              });
              await transaction.materialSearchDocument.deleteMany({
                where: { materialId: command.materialId },
              });
            }
            await markUnreferencedMaterialAssets(transaction, {
              materialId: command.materialId,
              orphanedAt: savedAt,
              referencedAssetIds: assetReferences.map(({ assetId }) => assetId),
            });
            if (command.deleteVideoId !== null) {
              const deletion = await requestVideoDeletion(transaction, {
                actor: command.actor,
                materialId: command.materialId,
                videoId: command.deleteVideoId,
              }, savedAt);
              if (!deletion.ok) {
                return rollback({
                  code: "invalid_reference",
                  issues: [{ code: deletion.code, path: "/deleteVideoId" }],
                });
              }
            }
            const detachment = await recordVideoDetachment(transaction, {
              materialId: command.materialId,
              videoIds: command.detachVideoIds,
            }, savedAt);
            if (!detachment.ok) {
              return rollback({
                code: "invalid_reference",
                issues: [{ code: detachment.code, path: "/detachVideoIds" }],
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
      "saveMaterial",
    );
    return result.ok ? { ok: true, value: result.value.receipt } : result;
  };
}

async function replacePublishedProjections(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly materialId: string;
    readonly contentVersion: number;
    readonly hasModeVariants: boolean;
    readonly metadata: {
      readonly access: "free" | "membership" | "workshop";
      readonly difficulty: MaterialDifficulty | null;
      readonly formatId: string;
      readonly outcomes: readonly string[];
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
    readonly primaryVideoId: string | null;
    readonly coverId: string | null;
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
      difficulty: values.metadata.difficulty,
      hasModeVariants: values.hasModeVariants,
      outcomes: [...values.metadata.outcomes],
      topicId: values.metadata.topicId,
      formatId: values.metadata.formatId,
      publicSearchText: "",
      publishedBy: values.publishedBy,
      publishedAt: values.publishedAt,
      primaryVideoId: values.primaryVideoId,
      coverId: values.coverId,
    },
    update: {
      contentVersion: BigInt(values.contentVersion),
      slug: values.metadata.slug,
      title: values.metadata.title,
      summary: values.metadata.summary,
      access: values.metadata.access,
      difficulty: values.metadata.difficulty,
      hasModeVariants: values.hasModeVariants,
      outcomes: [...values.metadata.outcomes],
      topicId: values.metadata.topicId,
      formatId: values.metadata.formatId,
      publicSearchText: "",
      publishedBy: values.publishedBy,
      publishedAt: values.publishedAt,
      primaryVideoId: values.primaryVideoId,
      coverId: values.coverId,
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
  await transaction.publishedMaterialGuideMembership.deleteMany({
    where: { materialId: values.materialId },
  });
  if (values.metadata.seriesMemberships.length > 0) {
    await transaction.publishedMaterialGuideMembership.createMany({
      data: values.metadata.seriesMemberships.map(({ seriesId, ordinal }) => ({
        materialId: values.materialId,
        seriesId,
        ordinal,
      })),
    });
  }
  await refreshPublishedMaterialSearchProjections(transaction, {
    kind: "materials",
    materialIds: [values.materialId],
  });
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

function requireDate(value: Date | null, field: string): Date {
  if (value === null) {
    throw new TypeError(`Published Material requires ${field}`);
  }
  return value;
}
