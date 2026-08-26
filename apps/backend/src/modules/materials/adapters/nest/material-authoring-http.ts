import { HttpException } from "@nestjs/common";
import { z } from "zod";

import type {
  CreateDraftError,
  LoadDraftError,
  PreviewRevisionError,
  PublishRevisionError,
  RestoreRevisionError,
  ReviseDraftError,
  UnpublishMaterialError,
  ValidateRevisionError,
} from "../../index.js";

const uuid = z.uuid();
const jsonObject = z.record(z.string(), z.unknown());

export const materialIdSchema = uuid;
export const revisionIdSchema = uuid;
export const platformSessionHeaderSchema = uuid;
export const idempotencyKeySchema = z.string().trim().min(1).max(200);

export const seriesMembershipSchema = z
  .object({ seriesId: uuid, ordinal: z.number().int().positive() })
  .strict();

export const materialMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(120),
    access: z.enum(["free", "membership"]),
    topicId: uuid,
    formatId: uuid,
    tagIds: z.array(uuid).max(100),
    seriesMemberships: z.array(seriesMembershipSchema).max(100),
  })
  .strict();

export const materialBodySnapshotSchema = z
  .object({ schemaVersion: z.literal(1), doc: jsonObject })
  .strict();

export const materialRevisionSchema = z
  .object({
    materialId: uuid,
    revisionId: uuid,
    metadata: materialMetadataSchema,
    body: materialBodySnapshotSchema,
  })
  .strict();

export const createDraftBodySchema = z
  .object({ metadata: materialMetadataSchema, body: jsonObject })
  .strict();

const materialBodyChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("replace_document"), document: jsonObject }).strict(),
  z
    .object({
      kind: z.literal("insert_blocks"),
      afterNodeId: uuid.nullable(),
      blocks: z.array(jsonObject),
    })
    .strict(),
  z
    .object({ kind: z.literal("replace_block"), nodeId: uuid, block: jsonObject })
    .strict(),
  z.object({ kind: z.literal("delete_block"), nodeId: uuid }).strict(),
  z
    .object({
      kind: z.literal("replace_text"),
      nodeId: uuid,
      from: z.number().int().nonnegative().max(500_000),
      to: z.number().int().nonnegative().max(500_000),
      text: z.string().max(500_000),
    })
    .strict(),
]);

export const reviseDraftBodySchema = z
  .object({
    baseRevisionId: uuid,
    changes: z
      .object({
        metadata: materialMetadataSchema.partial().optional(),
        body: z.array(materialBodyChangeSchema).max(500).optional(),
      })
      .strict(),
  })
  .strict();

export const restoreRevisionBodySchema = z
  .object({ baseRevisionId: uuid })
  .strict();

export const publishRevisionBodySchema = z
  .object({
    revisionId: uuid,
    expectedPublishedRevisionId: uuid.nullable(),
  })
  .strict();

export const unpublishMaterialBodySchema = z
  .object({ expectedPublishedRevisionId: uuid })
  .strict();

export const validationIssueSchema = z
  .object({ code: z.string(), path: z.string() })
  .strict();

export const validatedRevisionSchema = z
  .object({
    materialId: uuid,
    revisionId: uuid,
    projectionDigest: z.string(),
    extraction: z
      .object({
        plainText: z.string(),
        headings: z.array(
          z.object({ level: z.union([z.literal(2), z.literal(3), z.literal(4)]), text: z.string() }),
        ),
        resources: z.array(
          z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("image"), alt: z.string(), caption: z.string().optional() }),
            z.object({ kind: z.literal("file"), label: z.string() }),
            z.object({ kind: z.literal("video"), caption: z.string().optional() }),
          ]),
        ),
      })
      .strict(),
  })
  .strict();

// Rendered blocks are recursively nested. They remain runtime-validated by the
// owning web adapter; OpenAPI describes the stable envelope without emitting
// an invalid document-local recursive $ref from an inline schema.
export const renderedBlockSchema = z.unknown();

export const previewRevisionSchema = z
  .object({
    materialId: uuid,
    revisionId: uuid,
    metadata: materialMetadataSchema,
    cacheScope: z.literal("private-no-store"),
    body: z.object({ schemaVersion: z.literal(1), blocks: z.array(renderedBlockSchema) }),
  })
  .strict();

export const publicationLifecycleEventSchema = z
  .object({
    materialId: uuid,
    revisionId: uuid,
    publicationEventId: uuid,
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const materialAuthoringProblemSchema = z
  .looseObject({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    correlationId: z.string().optional(),
    retryable: z.boolean().optional(),
    issues: z.array(validationIssueSchema).optional(),
    currentRevisionId: uuid.optional(),
    currentPublishedRevisionId: uuid.nullable().optional(),
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
  | LoadDraftError
  | PreviewRevisionError
  | PublishRevisionError
  | RestoreRevisionError
  | ReviseDraftError
  | UnpublishMaterialError
  | ValidateRevisionError;

export type MaterialAuthoringErrorStatus = 403 | 404 | 409 | 422 | 500 | 503;

export function statusForMaterialAuthoringError(
  error: MaterialAuthoringTransportError,
): MaterialAuthoringErrorStatus {
  switch (error.code) {
    case "forbidden":
      return 403;
    case "material_not_found":
    case "publication_not_found":
    case "revision_not_found":
      return 404;
    case "idempotency_key_reused":
    case "series_ordinal_conflict":
    case "slug_conflict":
    case "stale_revision":
    case "stale_publication":
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

export function publicationEventToHttp(event: {
  readonly materialId: string;
  readonly revisionId: string;
  readonly publicationEventId: string;
  readonly recordedAt: Date;
}) {
  return { ...event, recordedAt: event.recordedAt.toISOString() };
}
