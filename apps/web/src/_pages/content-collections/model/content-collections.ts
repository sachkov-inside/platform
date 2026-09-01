import { z } from "zod";

export type ContentCollectionKind = "series" | "topic";

export const contentCollectionSchema = z
  .object({
    archived: z.boolean(),
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

export const contentCollectionMutationResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), collection: contentCollectionSchema }).strict(),
  z.object({ kind: z.literal("conflict") }).strict(),
  z.object({ kind: z.literal("slug_conflict") }).strict(),
  z.object({ kind: z.literal("invalid") }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("error"), reference: z.string() }).strict(),
]);

export type ContentCollectionMutationResult = z.infer<
  typeof contentCollectionMutationResultSchema
>;

export type CreateContentCollectionResult = ContentCollectionMutationResult;
export type UpdateContentCollectionResult = ContentCollectionMutationResult;
export type SetContentCollectionArchiveResult = ContentCollectionMutationResult;
