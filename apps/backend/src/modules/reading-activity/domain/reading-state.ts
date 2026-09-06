import { z } from "zod";

export const readingStateSchema = z.object({
  materialId: z.uuid(),
  isRead: z.boolean(),
  readAt: z.iso.datetime().nullable(),
  version: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime().nullable(),
}).strict();
export type ReadingState = z.infer<typeof readingStateSchema>;

export const readingOutcomeSchema = z.object({
  state: readingStateSchema,
  changed: z.boolean(),
}).strict();
