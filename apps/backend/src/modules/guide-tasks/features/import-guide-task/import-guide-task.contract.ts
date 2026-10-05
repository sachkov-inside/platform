import { z } from "zod";
import {
  taskCodeSchema,
  taskDefinitionSchema,
  taskProvenanceSchema,
  taskSourceIdSchema,
} from "../../domain/task-definition.js";
import type { Result, SystemError } from "../../shared/result.js";

const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * One Guide Task of a publication package, its Guide and chapter already resolved to Platform IDs
 * by the authoring tool. Related Materials stay named by their source, in their order.
 */
const sourceTaskFields = z
  .object({
    sourceId: taskSourceIdSchema,
    code: taskCodeSchema,
    guideId: z.uuid(),
    chapterId: z.uuid(),
    position: z.number().int().min(1).max(1_000),
    title: z.string().trim().min(1).max(200),
    access: z.enum(["free", "membership"]),
    definition: taskDefinitionSchema,
    relatedMaterialSourceIds: z.array(z.string().min(1).max(200)).max(50),
    publicationState: z.enum(["published", "unpublished"]),
    provenance: taskProvenanceSchema,
  })
  .strict();

function checkSourceTask(
  value: z.infer<typeof sourceTaskFields>,
  context: z.RefinementCtx,
): void {
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

export const sourceTaskSchema = sourceTaskFields.superRefine(checkSourceTask);

export const applySourceTaskBodySchema = sourceTaskFields
  .extend({
    /** The task revision the tool read; `null` for a task Platform does not hold yet. */
    expectedRevision: revisionSchema.nullable(),
  })
  .strict()
  .superRefine(checkSourceTask);

export const taskImportReceiptSchema = z
  .object({
    taskId: z.uuid(),
    code: taskCodeSchema,
    revision: revisionSchema,
    currentVersion: revisionSchema,
    definitionDigest: z.hash("sha256"),
    publicationState: z.enum(["published", "unpublished"]),
  })
  .strict();

export const validateSourceTaskResultSchema = z
  .object({
    valid: z.literal(true),
    current: taskImportReceiptSchema.nullable(),
  })
  .strict();

export type SourceTask = z.infer<typeof sourceTaskSchema>;
export type TaskImportReceipt = z.infer<typeof taskImportReceiptSchema>;

export type TaskImportError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "forbidden" }
  | { readonly code: "guide_not_found" }
  | { readonly code: "chapter_not_found" }
  | {
      readonly code: "related_material_not_found";
      readonly sourceIds: readonly string[];
    }
  | { readonly code: "source_mismatch" }
  | { readonly code: "task_revision_conflict" }
  | { readonly code: "idempotency_conflict" }
  | SystemError;

export type ApplySourceTaskOperation = (
  input: unknown,
  context: { readonly actor: string; readonly idempotencyKey: string },
) => Promise<Result<TaskImportReceipt, TaskImportError>>;

export type ValidateSourceTaskOperation = (
  input: unknown,
  context: { readonly actor: string },
) => Promise<
  Result<z.infer<typeof validateSourceTaskResultSchema>, TaskImportError>
>;
