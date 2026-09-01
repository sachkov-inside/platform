import { HttpException } from "@nestjs/common";
import { z } from "zod";

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
} from "../../index.js";
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
  .object({ expectedContentVersion: contentVersionSchema })
  .strict();

export const seriesOrderVersionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const seriesOrderSchema = z
  .object({
    items: z.array(
      z
        .object({
          materialId: materialIdSchema,
          ordinal: z.number().int().positive(),
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
    expectedOrderVersion: seriesOrderVersionSchema,
    orderedMaterialIds: z.array(materialIdSchema).max(10_000),
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

const renderedMarkSchema = z.union([
  z.object({ kind: z.enum(["bold", "code", "italic", "strike"]) }).strict(),
  z.object({ href: z.string(), kind: z.literal("link") }).strict(),
]);

const renderedTextSchema = z
  .object({
    kind: z.literal("text"),
    marks: z.array(renderedMarkSchema),
    text: z.string(),
  })
  .strict();

export const renderedBlockSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ content: z.array(renderedTextSchema), kind: z.literal("paragraph") }).strict(),
    z.object({ content: z.array(renderedTextSchema), kind: z.literal("heading"), level: z.union([z.literal(2), z.literal(3), z.literal(4)]) }).strict(),
    z.object({ items: z.array(z.array(renderedBlockSchema)), kind: z.literal("bullet_list") }).strict(),
    z.object({ items: z.array(z.array(renderedBlockSchema)), kind: z.literal("ordered_list") }).strict(),
    z.object({ content: z.array(renderedBlockSchema), kind: z.literal("blockquote") }).strict(),
    z.object({ kind: z.literal("code_block"), text: z.string() }).strict(),
    z.object({ kind: z.literal("horizontal_rule") }).strict(),
    z.object({ kind: z.literal("table"), rows: z.array(z.object({ cells: z.array(z.object({ content: z.array(renderedBlockSchema), header: z.boolean() }).strict()) }).strict()) }).strict(),
    z.object({ content: z.array(renderedBlockSchema), kind: z.literal("callout"), tone: z.enum(["note", "tip", "warning"]) }).strict(),
    z.object({
      alt: z.string(),
      assetId: z.uuid(),
      caption: z.string().optional(),
      height: z.number().int().positive().optional(),
      kind: z.literal("image"),
      variants: z
        .array(
          z
            .object({
              height: z.number().int().positive(),
              width: z.number().int().positive(),
            })
            .strict(),
        )
        .optional(),
      width: z.number().int().positive().optional(),
    }).strict(),
    z.object({
      assetId: z.uuid(),
      contentType: z.string().optional(),
      filename: z.string().optional(),
      kind: z.literal("file"),
      label: z.string(),
      size: z.number().int().nonnegative().optional(),
    }).strict(),
    z.object({ caption: z.string().optional(), kind: z.literal("video"), videoId: z.uuid() }).strict(),
  ]),
);

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
  | CreateDraftError
  | DeleteDraftError
  | LoadMaterialError
  | LoadSeriesOrderError
  | PreviewMaterialError
  | SaveMaterialError
  | ReorderSeriesError
  | TransitionMaterialPublicationError
  | ValidateMaterialError;

export type MaterialAuthoringErrorStatus = 403 | 404 | 409 | 422 | 500 | 503;

export function statusForMaterialAuthoringError(
  error: MaterialAuthoringTransportError,
): MaterialAuthoringErrorStatus {
  switch (error.code) {
    case "forbidden":
      return 403;
    case "material_not_found":
    case "series_not_found":
      return 404;
    case "draft_deletion_forbidden":
    case "idempotency_key_reused":
    case "invalid_publication_transition":
    case "series_ordinal_conflict":
    case "stale_content_version":
    case "series_membership_changed":
    case "stale_series_order":
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
