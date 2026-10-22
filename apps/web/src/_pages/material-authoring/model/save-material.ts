import { z } from "zod";

import { materialFormatSchema } from "@/shared/api/material-format";
import {
  MATERIAL_OUTCOMES,
  materialDifficultySchema,
} from "@/shared/api/material-lesson-facts";
import { productRemovalSchema } from "@/shared/lib/product-removal";

import {
  materialDocumentWireSchema,
  materialSeriesIdsWireSchema,
} from "./material-document-wire";

const issueSchema = z
  .object({ message: z.string(), path: z.string() })
  .strict();

export const saveMaterialResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      contentVersion: z.number().int().positive(),
      kind: z.literal("saved"),
      nextSubmissionId: z.uuid(),
      publicationState: z.enum(["draft", "published", "unpublished"]),
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
  z.object({ kind: z.literal("not_found") }).strict(),
  z
    .object({
      currentContentVersion: z.number().int().positive(),
      kind: z.literal("conflict"),
      staleContentVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("infrastructure_error"),
      reference: z.string(),
    })
    .strict(),
  z
    .object({
      products: z.array(productRemovalSchema).min(1).readonly(),
      kind: z.literal("removal_confirmation_required"),
    })
    .strict(),
]);

/** The full editor state one Save sends; the Route Handler parses it with this schema. */
export const saveMaterialInputSchema = z.object({
  access: z.enum(["free", "closed"]),
  /** Купленные продукты, снятие материала из которых автор подтвердил. */
  confirmedProductRemovals: z.array(z.uuid()).max(100).readonly().default([]),
  deleteVideoId: z.uuid().nullable().default(null),
  detachVideoIds: z.array(z.uuid()).readonly().default([]),
  difficulty: z
    .string()
    .pipe(materialDifficultySchema.or(z.literal("unassigned"))),
  document: materialDocumentWireSchema,
  expectedContentVersion: z.number().int().positive(),
  formatId: z.string().pipe(materialFormatSchema.or(z.literal("unassigned"))),
  materialId: z.uuid(),
  /** The author's Telegram choice; the editor always sends it, other callers may omit it. */
  notifyTelegram: z.boolean().optional(),
  outcomes: z
    .array(z.string().trim().max(MATERIAL_OUTCOMES.maxLength))
    .max(MATERIAL_OUTCOMES.maxCount)
    .readonly()
    .default([]),
  primaryVideoId: z.uuid().nullable().default(null),
  publicationState: z.enum(["draft", "published", "unpublished"]),
  seriesIds: materialSeriesIdsWireSchema,
  submissionId: z.uuid(),
  summary: z.string().trim().max(500),
  tagIds: z.array(z.uuid()).max(100).readonly().default([]),
  title: z.string().trim().max(160),
  topicId: z.union([z.uuid(), z.literal("unassigned")]),
});

export type SaveMaterialInput = z.input<typeof saveMaterialInputSchema>;

export type SaveMaterialResult = z.infer<typeof saveMaterialResultSchema>;
