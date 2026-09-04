import { z } from "zod";

import { contentCoverSchema } from "@/entities/material.model";

export type ContentCollectionKind = "series" | "topic";

export const contentCollectionSchema = z
  .object({
    archived: z.boolean(),
    cover: contentCoverSchema.nullable().optional(),
    id: z.uuid(),
    kind: z.enum(["series", "topic"]),
    materialCount: z.number().int().nonnegative(),
    name: z.string(),
    slug: z.string(),
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

export const createContentCollectionResultSchema = z.discriminatedUnion("kind", [
  savedContentCollectionResultSchema,
  slugConflictContentCollectionResultSchema,
  invalidContentCollectionResultSchema,
  unauthorizedContentCollectionResultSchema,
  contentCollectionMutationErrorSchema,
]);

export const updateContentCollectionResultSchema = z.discriminatedUnion("kind", [
  savedContentCollectionResultSchema,
  conflictContentCollectionResultSchema,
  invalidContentCollectionResultSchema,
  unauthorizedContentCollectionResultSchema,
  contentCollectionMutationErrorSchema,
]);

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
  | CreateContentCollectionResult
  | UpdateContentCollectionResult;
