import { z } from "zod";

import { contentCoverSchema } from "@/entities/material.model";

export type ContentCollectionKind = "series" | "topic";

/** One introduction field holds an authored paragraph, not a headline. */
export const PRODUCT_INTRODUCTION_FIELD_MAX = 4000;

export const productIntroductionSchema = z
  .object({
    audience: z.string().max(PRODUCT_INTRODUCTION_FIELD_MAX),
    outcome: z.string().max(PRODUCT_INTRODUCTION_FIELD_MAX),
    prerequisites: z.string().max(PRODUCT_INTRODUCTION_FIELD_MAX),
    scope: z.string().max(PRODUCT_INTRODUCTION_FIELD_MAX),
  })
  .strict();

export type ProductIntroductionDraft = z.infer<
  typeof productIntroductionSchema
>;

export const contentCollectionSchema = z
  .object({
    archived: z.boolean(),
    cover: contentCoverSchema.nullable().optional(),
    id: z.uuid(),
    introduction: productIntroductionSchema.nullable().default(null),
    kind: z.enum(["series", "topic"]),
    materialCount: z.number().int().nonnegative(),
    name: z.string(),
    // Страница Product из авторского оригинала (#671); список автора её не рисует, поэтому схема
    // её только пропускает, а не проверяет.
    page: z.unknown().optional(),
    pageRejected: z.boolean().optional(),
    presentation: z.string().nullable().optional(),
    slug: z.string(),
    sourceId: z.string().nullable().optional(),
    summary: z.string(),
    version: z.number().int().positive(),
  })
  .strict();

export type ContentCollection = z.infer<typeof contentCollectionSchema>;

export interface CreateContentCollectionInput {
  readonly kind: ContentCollectionKind;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
}

export interface UpdateContentCollectionInput {
  readonly collectionId: string;
  readonly expectedVersion: number;
  /** Omitted keeps the stored introduction; supplied replaces all four fields. */
  readonly introduction?: ProductIntroductionDraft;
  readonly kind: ContentCollectionKind;
  readonly name: string;
  readonly summary: string;
}

export interface SetContentCollectionArchiveInput {
  readonly archived: boolean;
  readonly collectionId: string;
  readonly expectedVersion: number;
  readonly kind: ContentCollectionKind;
}

const contentCollectionKindSchema = z.enum(["series", "topic"]);

/** The JSON body of a new Series or Topic; another field is ignored, as the former form did. */
export const createContentCollectionInputSchema = z.object({
  kind: contentCollectionKindSchema,
  name: z.string(),
  slug: z.string(),
  summary: z.string(),
});

/** The JSON body of a metadata save; an absent introduction keeps the stored one. */
export const updateContentCollectionInputSchema = z.object({
  collectionId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  // Прежняя форма читала только четыре поля введения, поэтому лишние поля отбрасываются.
  introduction: z.object(productIntroductionSchema.shape).optional(),
  kind: contentCollectionKindSchema,
  name: z.string(),
  summary: z.string(),
});

/** The JSON body of archiving or restoring a Series or Topic. */
export const setContentCollectionArchiveInputSchema = z.object({
  archived: z.boolean(),
  collectionId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  kind: contentCollectionKindSchema,
});

const savedContentCollectionResultSchema = z
  .object({ kind: z.literal("saved"), collection: contentCollectionSchema })
  .strict();
const conflictContentCollectionResultSchema = z
  .object({ kind: z.literal("conflict") })
  .strict();
const slugConflictContentCollectionResultSchema = z
  .object({ kind: z.literal("slug_conflict") })
  .strict();
const invalidContentCollectionResultSchema = z
  .object({ kind: z.literal("invalid") })
  .strict();
const unauthorizedContentCollectionResultSchema = z
  .object({ kind: z.literal("unauthorized") })
  .strict();
const contentCollectionMutationErrorSchema = z
  .object({ kind: z.literal("error"), reference: z.string() })
  .strict();

export const createContentCollectionResultSchema = z.discriminatedUnion(
  "kind",
  [
    savedContentCollectionResultSchema,
    slugConflictContentCollectionResultSchema,
    invalidContentCollectionResultSchema,
    unauthorizedContentCollectionResultSchema,
    contentCollectionMutationErrorSchema,
  ],
);

export const updateContentCollectionResultSchema = z.discriminatedUnion(
  "kind",
  [
    savedContentCollectionResultSchema,
    conflictContentCollectionResultSchema,
    invalidContentCollectionResultSchema,
    unauthorizedContentCollectionResultSchema,
    contentCollectionMutationErrorSchema,
  ],
);

export const setContentCollectionArchiveResultSchema = z.discriminatedUnion(
  "kind",
  [
    savedContentCollectionResultSchema,
    conflictContentCollectionResultSchema,
    invalidContentCollectionResultSchema,
    unauthorizedContentCollectionResultSchema,
    contentCollectionMutationErrorSchema,
  ],
);

export type CreateContentCollectionResult = z.infer<
  typeof createContentCollectionResultSchema
>;
export type UpdateContentCollectionResult = z.infer<
  typeof updateContentCollectionResultSchema
>;
export type SetContentCollectionArchiveResult = z.infer<
  typeof setContentCollectionArchiveResultSchema
>;
export type ContentCollectionMutationResult =
  CreateContentCollectionResult | UpdateContentCollectionResult;
