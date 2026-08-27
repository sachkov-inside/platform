import { HttpException } from "@nestjs/common";
import { z } from "zod";

import type {
  CreateDraftError,
  DeleteDraftError,
  LoadMaterialError,
  PreviewMaterialError,
  SaveMaterialError,
  ValidateMaterialError,
} from "../../index.js";

const uuid = z.uuid();
const jsonObject = z.record(z.string(), z.unknown());

export const materialIdSchema = uuid;
export const platformSessionHeaderSchema = uuid;
export const idempotencyKeySchema = z.string().trim().min(1).max(200);
export const contentVersionSchema = z.number().int().positive();

export const seriesMembershipSchema = z
  .object({ seriesId: uuid, ordinal: z.number().int().positive() })
  .strict();

export const materialMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(160).nullable(),
    summary: z.string().trim().min(1).max(500).nullable(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .max(120)
      .nullable(),
    access: z.enum(["free", "membership"]),
    topicId: uuid.nullable(),
    formatId: uuid.nullable(),
    tagIds: z.array(uuid).max(100),
    seriesMemberships: z.array(seriesMembershipSchema).max(100),
  })
  .strict();

export const materialBodySnapshotSchema = z
  .object({ schemaVersion: z.literal(1), doc: jsonObject })
  .strict();

export const materialMutationReceiptSchema = z
  .object({
    materialId: uuid,
    contentVersion: contentVersionSchema,
    publicationState: z.enum(["draft", "published", "unpublished"]),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const materialSchema = z
  .object({
    materialId: uuid,
    contentVersion: contentVersionSchema,
    publicationState: z.enum(["draft", "published", "unpublished"]),
    firstPublishedAt: z.iso.datetime({ offset: true }).nullable(),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    metadata: materialMetadataSchema,
    body: materialBodySnapshotSchema,
  })
  .strict();

export const createDraftBodySchema = z
  .object({ metadata: materialMetadataSchema, body: materialBodySnapshotSchema })
  .strict();

export const saveMaterialBodySchema = z
  .object({
    expectedContentVersion: contentVersionSchema,
    publicationState: z.enum(["draft", "published", "unpublished"]),
    metadata: materialMetadataSchema,
    body: materialBodySnapshotSchema,
  })
  .strict();

export const deleteDraftBodySchema = z
  .object({ expectedContentVersion: contentVersionSchema })
  .strict();

export const validationIssueSchema = z
  .object({ code: z.string(), path: z.string() })
  .strict();

export const validatedMaterialSchema = z
  .object({
    materialId: uuid,
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
              alt: z.string(),
              caption: z.string().optional(),
            }),
            z.object({ kind: z.literal("file"), label: z.string() }),
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

// Rendered blocks are recursively nested. The owning web adapter validates the
// exact recursive shape; OpenAPI keeps a stable envelope without an inline $ref.
export const renderedBlockSchema = z.unknown();

export const previewMaterialSchema = z
  .object({
    materialId: uuid,
    contentVersion: contentVersionSchema,
    publicationState: z.enum(["draft", "published", "unpublished"]),
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
  currentState: z.enum(["draft", "published", "unpublished"]).optional(),
  targetState: z.enum(["draft", "published", "unpublished"]).optional(),
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
  | PreviewMaterialError
  | SaveMaterialError
  | ValidateMaterialError;

export type MaterialAuthoringErrorStatus = 403 | 404 | 409 | 422 | 500 | 503;

export function statusForMaterialAuthoringError(
  error: MaterialAuthoringTransportError,
): MaterialAuthoringErrorStatus {
  switch (error.code) {
    case "forbidden":
      return 403;
    case "material_not_found":
      return 404;
    case "draft_deletion_forbidden":
    case "idempotency_key_reused":
    case "invalid_publication_transition":
    case "series_ordinal_conflict":
    case "slug_conflict":
    case "slug_locked":
    case "stale_content_version":
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
