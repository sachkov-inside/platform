import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

import { guideRemovalSchema } from "@/shared/lib/guide-removal";

const issueSchema = z.object({ message: z.string(), path: z.string() }).strict();

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
      guides: z.array(guideRemovalSchema).min(1).readonly(),
      kind: z.literal("removal_confirmation_required"),
    })
    .strict(),
]);

export interface SaveMaterialInput {
  readonly access: "free" | "membership";
  /** Купленные продукты, снятие материала из которых автор подтвердил. */
  readonly confirmedGuideRemovals?: readonly string[];
  readonly deleteVideoId: string | null;
  readonly detachVideoIds: readonly string[];
  readonly difficulty: string;
  readonly document: JSONContent;
  readonly expectedContentVersion: number;
  readonly formatId: string;
  readonly outcomes: readonly string[];
  readonly materialId: string;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly primaryVideoId: string | null;
  readonly seriesIds: readonly string[];
  readonly submissionId: string;
  readonly summary: string;
  readonly tagIds: readonly string[];
  readonly title: string;
  readonly topicId: string;
}

export type SaveMaterialResult = z.infer<typeof saveMaterialResultSchema>;
