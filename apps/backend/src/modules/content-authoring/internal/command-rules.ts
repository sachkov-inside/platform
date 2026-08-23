import { z } from "zod";

import { validationIssuePath } from "../../content-schema/index.js";
import type {
  ApplicationResult,
  CreateDraftCommand,
  LoadDraftQuery,
  ReviseDraftCommand,
} from "../content-authoring.interface.js";
import { materialMetadataFields } from "./material-rules.js";

const principalId = z.uuid().transform((value) => value.toLowerCase());
const entityId = z.uuid().transform((value) => value.toLowerCase());
const idempotencyKey = z.string().trim().min(1).max(200);

const draftMetadataInput = z
  .object(materialMetadataFields)
  .strict();

const metadataChanges = z
  .object({
    title: materialMetadataFields.title.optional(),
    summary: materialMetadataFields.summary.optional(),
    slug: materialMetadataFields.slug.optional(),
    topicId: materialMetadataFields.topicId.optional(),
    formatId: materialMetadataFields.formatId.optional(),
    tagIds: materialMetadataFields.tagIds.optional(),
    seriesMemberships: materialMetadataFields.seriesMemberships.optional(),
  })
  .strict();

const documentChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("replace_document"), document: z.unknown() }).strict(),
  z
    .object({
      kind: z.literal("insert_blocks"),
      afterNodeId: entityId.nullable(),
      blocks: z.array(z.unknown()).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("replace_block"),
      nodeId: entityId,
      block: z.unknown(),
    })
    .strict(),
  z.object({ kind: z.literal("delete_block"), nodeId: entityId }).strict(),
  z
    .object({
      kind: z.literal("replace_text"),
      nodeId: entityId,
      from: z.number().int().nonnegative().max(500_000),
      to: z.number().int().nonnegative().max(500_000),
      text: z.string().max(500_000),
    })
    .strict(),
]);

const createDraftCommand = z
  .object({
    actor: principalId,
    idempotencyKey,
    metadata: draftMetadataInput,
    body: z.unknown(),
  })
  .strict();

const loadDraftQuery = z
  .object({
    actor: principalId,
    materialId: entityId,
  })
  .strict();

const reviseDraftCommand = z
  .object({
    actor: principalId,
    idempotencyKey,
    materialId: entityId,
    baseRevisionId: entityId,
    changes: z
      .object({
        metadata: metadataChanges.optional(),
        body: z.array(documentChange).max(100).optional(),
      })
      .strict(),
  })
  .strict();

function parseCommand<Value>(schema: z.ZodType<Value>, input: unknown): ApplicationResult<Value> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    error: {
      code: "invalid_content",
      issues: parsed.error.issues
        .map((issue) => ({ code: "invalid_command", path: validationIssuePath(issue.path) }))
        .sort((left, right) => left.path.localeCompare(right.path))
        .slice(0, 100),
    },
  };
}

export function parseCreateDraftCommand(input: unknown): ApplicationResult<CreateDraftCommand> {
  return parseCommand(createDraftCommand, input);
}

export function parseLoadDraftQuery(input: unknown): ApplicationResult<LoadDraftQuery> {
  return parseCommand(loadDraftQuery, input);
}

export function parseReviseDraftCommand(input: unknown): ApplicationResult<ReviseDraftCommand> {
  return parseCommand(reviseDraftCommand, input);
}
