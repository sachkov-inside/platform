import { z } from "zod";

export const bookmarkStateSchema = z.object({
  materialId: z.uuid(),
  bookmarked: z.boolean(),
  bookmarkedAt: z.iso.datetime().nullable(),
}).strict();
export type BookmarkState = z.infer<typeof bookmarkStateSchema>;
