export interface DeleteMaterialDraftInput {
  readonly deleteVideoId: string | null;
  readonly expectedContentVersion: number;
  readonly materialId: string;
  readonly submissionId: string;
}

export type DeleteMaterialDraftResult = z.infer<
  typeof deleteMaterialDraftResultSchema
>;
import { z } from "zod";

const issueSchema = z.object({ code: z.string(), path: z.string() }).strict();

export const deleteMaterialDraftResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deleted"), materialId: z.uuid() }).strict(),
  z
    .object({
      issues: z.array(issueSchema).readonly(),
      kind: z.literal("invalid_input"),
    })
    .strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("not_found") }).strict(),
  z
    .object({
      currentContentVersion: z.number().int().positive().optional(),
      kind: z.literal("conflict"),
      reason: z.enum([
        "draft_deletion_forbidden",
        "idempotency_key_reused",
        "stale_content_version",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("infrastructure_error"),
      reference: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("unexpected_error"), reference: z.string() }).strict(),
]);
