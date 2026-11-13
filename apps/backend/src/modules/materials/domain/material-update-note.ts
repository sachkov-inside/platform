import { z } from "zod";

/**
 * A substantial update the author noted on a published lesson, as the authoring package sends it
 * (#2125). `id` is the source's stable name for this update: the package keeps the note between
 * syncs, so the same `id` is the same update and a new `id` is a new one. `whatChanged` is the
 * plain «Что изменилось» text shown to readers who studied the lesson before the update.
 */
export const materialUpdateNoteSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    whatChanged: z.string().trim().min(1).max(500),
  })
  .strict();
export type MaterialUpdateNoteInput = z.infer<typeof materialUpdateNoteSchema>;
