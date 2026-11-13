import { z } from "zod";

/**
 * A substantial update the author noted on a published lesson, as the authoring package sends it
 * (#2125; content-studio#89 owns the package side). `id` is the source's stable kebab name for
 * this update, usually its date: the package keeps the note between syncs, so the same `id` is the
 * same update and a new `id` is a new one. `whatChanged` is one line of plain «Что изменилось»
 * text shown to readers who studied the lesson before the update.
 */
export const materialUpdateNoteSchema = z
  .object({
    id: z
      .string()
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    whatChanged: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((text) => !/[\r\n]/u.test(text), "One line of text"),
  })
  .strict();
export type MaterialUpdateNoteInput = z.infer<typeof materialUpdateNoteSchema>;
