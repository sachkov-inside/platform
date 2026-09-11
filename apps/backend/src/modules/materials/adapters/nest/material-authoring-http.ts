import type { SetHomePinError } from "../../features/set-home-pin/set-home-pin.contract.js";
import { HttpException } from "@nestjs/common";
import { extendedRenderedBlockSchema } from "@inside/material-blocks";
import { z } from "zod";
import {
  GUIDE_CHAPTER_NAME_MAX,
  GUIDE_CHAPTER_SUMMARY_MAX,
  guideChapterAssignmentsSchema,
  guideChapterDraftsSchema,
} from "../../shared/guide-chapters.js";
import { seriesStepGroupsSchema } from "../../shared/series-step-groups.js";
import { GUIDE_INTRODUCTION_FIELD_MAX } from "../../facets/material-authoring/content-collection.contract.js";

import type {
  CreateDraftError,
  DeleteDraftError,
  LoadSeriesOrderError,
  LoadMaterialError,
  PreviewMaterialError,
  SaveMaterialError,
  ReorderSeriesError,
  TransitionMaterialPublicationError,
  ValidateMaterialError,
  CreateContentCollectionError,
  SetContentCollectionArchiveError,
  UpdateContentCollectionError,
} from "../../index.js";
import { videoAuthoringPresentationSchema } from "../../../videos/index.js";
import { contentCoverProjectionHttpSchema } from "./content-cover-http.js";
import {
  contentVersionWireSchema,
  idempotencyKeyWireSchema,
  materialBodySnapshotWireSchema,
  materialIdWireSchema,
  materialMetadataSelectionWireSchema,
  materialMetadataWireSchema,
  publicationStateWireSchema,
  seriesMembershipWireSchema,
} from "../material-authoring-wire.js";

export const materialIdSchema = materialIdWireSchema;
export const platformSessionHeaderSchema = z.uuid();
export const idempotencyKeySchema = idempotencyKeyWireSchema;
export const contentVersionSchema = contentVersionWireSchema;
export const seriesMembershipSchema = seriesMembershipWireSchema;
export const materialMetadataSchema = materialMetadataWireSchema;
export const materialMetadataSelectionSchema = materialMetadataSelectionWireSchema;
export const materialBodySnapshotSchema = materialBodySnapshotWireSchema;

export const materialMutationReceiptSchema = z
  .object({
    materialId: materialIdSchema,
    contentVersion: contentVersionSchema,
    publicationState: publicationStateWireSchema,
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const materialSchema = z
  .object({
    materialId: materialIdSchema,
    contentVersion: contentVersionSchema,
    publicationState: publicationStateWireSchema,
    primaryVideoId: z.uuid().nullable(),
    primaryVideo: videoAuthoringPresentationSchema.nullable(),
    latestVideoDeletion: videoAuthoringPresentationSchema.nullable(),
    cover: contentCoverProjectionHttpSchema.nullable(),
    firstPublishedAt: z.iso.datetime({ offset: true }).nullable(),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    metadata: materialMetadataSchema,
    body: materialBodySnapshotSchema,
  })
  .strict();

export const createDraftBodySchema = z
  .object({ metadata: materialMetadataSelectionSchema, body: materialBodySnapshotSchema })
  .strict();

export const saveMaterialBodySchema = z
  .object({
    expectedContentVersion: contentVersionSchema,
    publicationState: publicationStateWireSchema,
    primaryVideoId: z.uuid().nullable().default(null),
    deleteVideoId: z.uuid().nullable().default(null),
    metadata: materialMetadataSelectionSchema,
    body: materialBodySnapshotSchema,
  })
  .strict();

export const transitionMaterialPublicationBodySchema = z
  .object({
    expectedContentVersion: contentVersionSchema,
    publicationState: z.enum(["published", "unpublished"]),
  })
  .strict();

export const deleteDraftBodySchema = z
  .object({
    deleteVideoId: z.uuid().nullable().default(null),
    expectedContentVersion: contentVersionSchema,
  })
  .strict();

export const seriesOrderVersionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const guideChapterSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(GUIDE_CHAPTER_NAME_MAX),
    ordinal: z.number().int().positive(),
    summary: z.string().max(GUIDE_CHAPTER_SUMMARY_MAX),
  })
  .strict();
export const seriesOrderSchema = z
  .object({
    archived: z.boolean(),
    chapters: z.array(guideChapterSchema),
    items: z.array(
      z
        .object({
          chapterId: z.uuid().nullable(),
          materialId: materialIdSchema,
          ordinal: z.number().int().positive(),
          stepGroup: z.string().nullable(),
          publicationState: publicationStateWireSchema,
          title: z.string().nullable(),
        })
        .strict(),
    ),
    name: z.string().min(1),
    orderVersion: seriesOrderVersionSchema,
    seriesId: z.uuid(),
  })
  .strict();
export const reorderSeriesBodySchema = z
  .object({
    chapters: guideChapterDraftsSchema.optional(),
    chapterAssignments: guideChapterAssignmentsSchema.optional(),
    expectedOrderVersion: seriesOrderVersionSchema,
    orderedMaterialIds: z.array(materialIdSchema),
    stepGroups: seriesStepGroupsSchema.optional(),
  })
  .strict()
  .refine(
    ({ orderedMaterialIds }) =>
      new Set(orderedMaterialIds).size === orderedMaterialIds.length,
    { path: ["orderedMaterialIds"], message: "Material IDs must be unique" },
  );
export const reorderSeriesReceiptSchema = z
  .object({ seriesId: z.uuid(), orderVersion: seriesOrderVersionSchema })
  .strict();

export const contentCollectionKindSchema = z.enum(["guide", "series", "topic"]);
const introductionField = z.string().max(GUIDE_INTRODUCTION_FIELD_MAX);
export const guideIntroductionSchema = z
  .object({
    audience: introductionField,
    outcome: introductionField,
    prerequisites: introductionField,
    scope: introductionField,
  })
  .strict();
export const contentCollectionSchema = z
  .object({
    archived: z.boolean(),
    id: z.uuid(),
    introduction: guideIntroductionSchema.nullable(),
    kind: contentCollectionKindSchema,
    materialCount: z.number().int().nonnegative(),
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(120),
    summary: z.string().max(500),
    version: z.number().int().positive(),
    cover: contentCoverProjectionHttpSchema.nullable(),
  })
  .strict();
export const contentCollectionListSchema = z.array(contentCollectionSchema);
export const createContentCollectionBodySchema = z
  .object({
    kind: contentCollectionKindSchema,
    name: z.string(),
    slug: z.string(),
    summary: z.string(),
  })
  .strict();
export const updateContentCollectionBodySchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    introduction: guideIntroductionSchema.optional(),
    kind: contentCollectionKindSchema,
    name: z.string(),
    summary: z.string(),
  })
  .strict();
export const setContentCollectionArchiveBodySchema = z
  .object({
    archived: z.boolean(),
    expectedVersion: z.number().int().positive(),
    kind: contentCollectionKindSchema,
  })
  .strict();

export const validationIssueSchema = z
  .object({ code: z.string(), path: z.string() })
  .strict();

export const validatedMaterialSchema = z
  .object({
    materialId: materialIdSchema,
    contentVersion: contentVersionSchema,
    projectionDigest: z.string(),
    extraction: z
      .object({
        plainText: z.string(),
        headings: z.array(
          z.object({
            level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
            text: z.string(),
          }),
        ),
        resources: z.array(
          z.discriminatedUnion("kind", [
            z.object({
              kind: z.literal("image"),
              assetId: z.uuid(),
              alt: z.string(),
              caption: z.string().optional(),
            }),
            z.object({ assetId: z.uuid(), kind: z.literal("file"), label: z.string() }),
            z.object({
              kind: z.literal("video"),
              caption: z.string().optional(),
            }),
          ]),
        ),
      })
      .strict(),
  })
  .strict();

/**
 * The wire contract still publishes the inline `video` block the document schema stopped
 * accepting; it is enumerated here so the description keeps its shape, while every block the
 * platform renders comes from the registry.
 */
const legacyVideoBlockSchema = z
  .object({ caption: z.string().optional(), kind: z.literal("video"), videoId: z.uuid() })
  .strict();

export const renderedBlockSchema: z.ZodType = extendedRenderedBlockSchema([
  legacyVideoBlockSchema,
]);

export const previewMaterialSchema = z
  .object({
    materialId: materialIdSchema,
    contentVersion: contentVersionSchema,
    publicationState: publicationStateWireSchema,
    metadata: materialMetadataSchema,
    cacheScope: z.literal("private-no-store"),
    body: z
      .object({
        schemaVersion: z.literal(1),
        blocks: z.array(renderedBlockSchema),
      })
      .strict(),
  })
  .strict();

export const materialAuthoringProblemSchema = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  correlationId: z.string().optional(),
  retryable: z.boolean().optional(),
  issues: z.array(validationIssueSchema).optional(),
  currentContentVersion: contentVersionSchema.optional(),
  currentOrderVersion: seriesOrderVersionSchema.optional(),
  currentVersion: z.number().int().positive().optional(),
  currentState: publicationStateWireSchema.optional(),
  targetState: publicationStateWireSchema.optional(),
});

export function parseMaterialAuthoringBody<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }
  throw new HttpException(
    {
      type: "urn:inside:problem:invalid-request-shape",
      title: "Material authoring request is malformed",
      status: 400,
      code: "invalid_request_shape",
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: `/${issue.path.map(String).join("/")}`,
      })),
    },
    400,
  );
}

type MaterialAuthoringTransportError =
  | SetHomePinError
  | CreateDraftError
  | DeleteDraftError
  | LoadMaterialError
  | LoadSeriesOrderError
  | PreviewMaterialError
  | SaveMaterialError
  | ReorderSeriesError
  | TransitionMaterialPublicationError
  | ValidateMaterialError
  | CreateContentCollectionError
  | SetContentCollectionArchiveError
  | UpdateContentCollectionError;

export type MaterialAuthoringErrorStatus = 403 | 404 | 409 | 422 | 500 | 503;

export function statusForMaterialAuthoringError(
  error: MaterialAuthoringTransportError,
): MaterialAuthoringErrorStatus {
  switch (error.code) {
    case "forbidden":
      return 403;
    case "material_not_found":
    case "series_not_found":
    case "content_collection_not_found":
      return 404;
    case "draft_deletion_forbidden":
    case "idempotency_key_reused":
    case "invalid_publication_transition":
    case "series_ordinal_conflict":
    case "stale_content_version":
    case "stale_series_order":
    case "stale_home_pin":
    case "content_collection_slug_conflict":
    case "stale_content_collection_version":
      return 409;
    case "duplicate_tag":
    case "invalid_content":
    case "invalid_reference":
      return 422;
    case "dependency_unavailable":
      return 503;
    case "internal_error":
      return 500;
  }
}

export function throwMaterialAuthoringError(
  error: MaterialAuthoringTransportError,
): never {
  const status = statusForMaterialAuthoringError(error);
  throw new HttpException(
    {
      type: `urn:inside:problem:${error.code.replaceAll("_", "-")}`,
      title: titleForMaterialAuthoringError(status),
      status,
      ...error,
    },
    status,
  );
}

function titleForMaterialAuthoringError(status: number): string {
  if (status === 403) return "Material authoring is forbidden";
  if (status === 404) return "Material authoring resource not found";
  if (status === 409) return "Material authoring conflict";
  if (status === 422) return "Material authoring input is invalid";
  if (status === 503) return "Material authoring dependency unavailable";
  return "Material authoring failed";
}
