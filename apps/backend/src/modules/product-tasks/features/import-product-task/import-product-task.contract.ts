import { z } from "zod";
import {
  taskAccessSchema,
  taskPublicationSchema,
  taskCodeSchema,
  taskDefinitionSchema,
  taskProvenanceSchema,
  taskSourceIdSchema,
} from "../../domain/task-definition.js";
import type { Result, SystemError } from "../../shared/result.js";

import {
  sourceTaskPageSchema,
  taskPageBodySchema,
  taskImageReferenceSchema,
} from "../../domain/task-page.js";

const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * One Product Task of a publication package, its Product and chapter already resolved to Platform IDs
 * by the authoring tool. Related Materials stay named by their source, in their order.
 */
const sourceTaskFields = z
  .object({
    sourceId: taskSourceIdSchema,
    code: taskCodeSchema,
    productId: z.uuid(),
    chapterId: z.uuid(),
    position: z.number().int().min(1).max(1_000),
    title: z.string().trim().min(1).max(200),
    access: taskAccessSchema,
    definition: taskDefinitionSchema,
    page: sourceTaskPageSchema.optional(),
    pageBody: taskPageBodySchema.optional(),
    resolvedLinks: z.record(z.string(), taskSourceIdSchema).default({}),
    resolvedImages: z.record(z.string(), taskImageReferenceSchema).default({}),
    relatedMaterialSourceIds: z.array(z.string().min(1).max(200)).max(50),
    /**
     * The Material of the same chapter right after which the programme shows the task; `null` puts
     * it at the start of the chapter. An older tool that omits it means `null`.
     */
    afterMaterialSourceId: z.string().min(1).max(200).nullable().default(null),
    publicationState: taskPublicationSchema,
    provenance: taskProvenanceSchema,
  })
  .strict();

function checkSourceTask(
  value: Pick<
    z.infer<typeof sourceTaskFields>,
    "sourceId" | "code" | "relatedMaterialSourceIds" | "definition" | "page"
  >,
  context: z.RefinementCtx,
): void {
  if (value.definition.schemaVersion === 2 && value.page === undefined)
    context.addIssue({
      code: "custom",
      path: ["page"],
      message: "Format c requires its source page",
    });
  if (!value.sourceId.endsWith(`:${value.code}`))
    context.addIssue({
      code: "custom",
      path: ["sourceId"],
      message: "The source ID must name the task code",
    });
  if (
    new Set(value.relatedMaterialSourceIds).size !==
    value.relatedMaterialSourceIds.length
  )
    context.addIssue({
      code: "custom",
      path: ["relatedMaterialSourceIds"],
      message: "Related Materials repeat",
    });
}

/**
 * What validation reads: the authored task without its placement, which a preflight may not know
 * yet for a Product that the same transfer creates.
 */
export const sourceTaskSchema = sourceTaskFields
  .partial({ productId: true, chapterId: true, position: true })
  .superRefine(checkSourceTask);

export const applySourceTaskBodySchema = sourceTaskFields
  .extend({
    /** The task revision the tool read; `null` for a task Platform does not hold yet. */
    expectedRevision: revisionSchema.nullable(),
  })
  .strict()
  .superRefine(checkSourceTask)
  .superRefine((value, context) => {
    const page = value.page;
    if (page === undefined) return;
    if (value.pageBody === undefined)
      context.addIssue({
        code: "custom",
        path: ["pageBody"],
        message: "Page requires a MaterialBody",
      });
    if (
      Object.keys(page.links).some(
        (address) => value.resolvedLinks[address] === undefined,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["resolvedLinks"],
        message: "Every source link requires its source mapping",
      });
    const keys = [
      ...Object.keys(page.images),
      ...(page.coverAssetId === undefined || page.coverAssetId === null
        ? []
        : [`cover:${page.coverAssetId}`]),
      ...(page.artifacts ?? []).map((item) => `artifact:${item.sourceId}`),
    ];
    if (
      keys.some((key) => value.resolvedImages[key] === undefined) ||
      Object.keys(value.resolvedImages).some((key) => !keys.includes(key))
    )
      context.addIssue({
        code: "custom",
        path: ["resolvedImages"],
        message: "Every page asset requires exactly its source mapping",
      });
  });

export const taskImportReceiptSchema = z
  .object({
    taskId: z.uuid(),
    code: taskCodeSchema,
    revision: revisionSchema,
    currentVersion: revisionSchema,
    definitionDigest: z.hash("sha256"),
    publicationState: taskPublicationSchema,
  })
  .strict();

export const validateSourceTaskResultSchema = z
  .object({
    valid: z.literal(true),
    current: taskImportReceiptSchema.nullable(),
    migration: z.object({ materialId: z.uuid() }).strict().nullable(),
  })
  .strict();

/** One placed task as apply imports it. */
export type SourceTask = Omit<
  z.infer<typeof applySourceTaskBodySchema>,
  "expectedRevision"
>;
export type TaskImportReceipt = z.infer<typeof taskImportReceiptSchema>;

export type TaskImportError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "forbidden" }
  | { readonly code: "product_not_found" }
  | { readonly code: "chapter_not_found" }
  | {
      readonly code: "related_material_not_found";
      readonly sourceIds: readonly string[];
    }
  | {
      readonly code: "after_material_not_in_chapter";
      readonly sourceId: string;
    }
  | { readonly code: "source_mismatch" }
  | { readonly code: "task_revision_conflict" }
  | { readonly code: "idempotency_conflict" }
  | SystemError;

export type ApplySourceTaskOperation = (
  input: unknown,
  context: { readonly actor: string; readonly idempotencyKey: string },
) => Promise<Result<TaskImportReceipt, TaskImportError>>;

/** Validation writes nothing and judges no placement, so it has fewer outcomes than apply. */
export type TaskValidationError = Extract<
  TaskImportError,
  {
    readonly code:
      | "invalid_request_shape"
      | "forbidden"
      | "source_mismatch"
      | "dependency_unavailable"
      | "internal_error";
  }
>;

export type ValidateSourceTaskOperation = (
  input: unknown,
  context: { readonly actor: string },
) => Promise<
  Result<z.infer<typeof validateSourceTaskResultSchema>, TaskValidationError>
>;
