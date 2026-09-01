import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

const issueSchema = z.object({ message: z.string(), path: z.string() }).strict();

export const createMaterialDraftResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      draft: z
        .object({
          contentVersion: z.number().int().positive(),
          materialId: z.uuid(),
        })
        .strict(),
      kind: z.literal("created"),
    })
    .strict(),
  z
    .object({
      issues: z.array(issueSchema).readonly(),
      kind: z.literal("invalid_input"),
    })
    .strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("unexpected_error"), reference: z.string() }).strict(),
]);

export interface CreateMaterialDraftInput {
  readonly access: "free" | "membership";
  readonly document: JSONContent;
  readonly formatId: string;
  readonly seriesIds: readonly string[];
  readonly submissionId: string;
  readonly summary: string;
  readonly tagIds: readonly string[];
  readonly title: string;
  readonly topicId: string;
}

export type CreateMaterialDraftResult = z.infer<
  typeof createMaterialDraftResultSchema
>;
export type CreatedMaterialDraft = Extract<
  CreateMaterialDraftResult,
  { kind: "created" }
>["draft"];
