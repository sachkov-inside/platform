import { z } from "zod";

import { materialPreviewSchema, type MaterialPreview } from "@/entities/material";

export const bookmarkStateSchema = z
  .object({
    materialId: z.uuid(),
    bookmarked: z.boolean(),
    bookmarkedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type BookmarkState = z.infer<typeof bookmarkStateSchema>;

export const bookmarkStatesResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), states: z.array(bookmarkStateSchema).max(100) }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
]);

export const bookmarkStateResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), state: bookmarkStateSchema }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("denied") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
]);

export const bookmarkCommandSchema = z
  .object({ materialId: z.uuid(), bookmarked: z.boolean() })
  .strict();
export type BookmarkCommand = z.infer<typeof bookmarkCommandSchema>;

export interface BookmarkListPage {
  readonly items: readonly MaterialPreview[];
  readonly nextCursor: string | null;
}

export const bookmarkListPageSchema: z.ZodType<BookmarkListPage> = z
  .object({
    items: z.array(materialPreviewSchema),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();

export type BookmarkListResult =
  | ({ readonly kind: "ready" } & BookmarkListPage)
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable" };

export type BookmarkStateResult =
  | { readonly kind: "ready"; readonly state: BookmarkState }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };
