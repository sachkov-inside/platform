import { z } from "zod";

export const readingStateSchema = z
  .object({
    materialId: z.uuid(),
    isRead: z.boolean(),
    readAt: z.iso.datetime().nullable(),
    version: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type ReadingState = z.infer<typeof readingStateSchema>;

/**
 * The personal state a Material list or the Reader shows. `updateNote` is the author's
 * «Что изменилось» for a substantial update the Account has not seen yet: the Account marked the
 * Material studied before the update and has not opened it since (#2125). The studied mark stays.
 */
export const materialReadingStateSchema = readingStateSchema
  .extend({
    updateNote: z
      .object({ whatChanged: z.string().min(1), notedAt: z.iso.datetime() })
      .strict()
      .nullable(),
  })
  .strict();
export type MaterialReadingState = z.infer<typeof materialReadingStateSchema>;

export const readingOutcomeSchema = z
  .object({
    state: readingStateSchema,
    changed: z.boolean(),
  })
  .strict();
