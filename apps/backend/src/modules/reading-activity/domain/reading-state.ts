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

export function toReadingState(materialId: string, row: {
  isRead: boolean;
  readAt: Date | null;
  version: number;
  updatedAt: Date;
} | null): ReadingState {
  return {
    materialId,
    isRead: row?.isRead ?? false,
    readAt: row?.readAt?.toISOString() ?? null,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}
