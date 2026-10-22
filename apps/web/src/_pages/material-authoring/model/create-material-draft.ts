import { z } from "zod";

import { materialFormatSchema } from "@/shared/api/material-format";
import {
  MATERIAL_OUTCOMES,
  materialDifficultySchema,
} from "@/shared/api/material-lesson-facts";

import {
  materialDocumentWireSchema,
  materialSeriesIdsWireSchema,
} from "./material-document-wire";

const issueSchema = z
  .object({ message: z.string(), path: z.string() })
  .strict();

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
  z
    .object({ kind: z.literal("unexpected_error"), reference: z.string() })
    .strict(),
]);

/** The editor state that creates a draft; the Route Handler parses it with this schema. */
export const createMaterialDraftInputSchema = z.object({
  access: z.enum(["free", "closed"]),
  difficulty: z
    .string()
    .pipe(materialDifficultySchema.or(z.literal("unassigned"))),
  document: materialDocumentWireSchema,
  formatId: z.string().pipe(materialFormatSchema.or(z.literal("unassigned"))),
  outcomes: z
    .array(z.string().trim().max(MATERIAL_OUTCOMES.maxLength))
    .max(MATERIAL_OUTCOMES.maxCount)
    .readonly()
    .default([]),
  seriesIds: materialSeriesIdsWireSchema,
  submissionId: z.uuid(),
  summary: z.string().trim().max(500),
  tagIds: z.array(z.uuid()).max(100).readonly().default([]),
  title: z.string().trim().min(1).max(160),
  topicId: z.union([z.uuid(), z.literal("unassigned")]),
});

export type CreateMaterialDraftInput = z.input<
  typeof createMaterialDraftInputSchema
>;

export type CreateMaterialDraftResult = z.infer<
  typeof createMaterialDraftResultSchema
>;
export type CreatedMaterialDraft = Extract<
  CreateMaterialDraftResult,
  { kind: "created" }
>["draft"];
