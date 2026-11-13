import { z } from "zod";

/** The bound the backend keeps; a lesson has far fewer parts (#2122). */
export const LESSON_OPENED_PARTS_MAX = 1000;

const openedPartsSchema = z.number().int().min(1).max(LESSON_OPENED_PARTS_MAX);

export const openedPartsCommandSchema = z
  .object({ materialId: z.uuid(), openedParts: openedPartsSchema })
  .strict();
export type OpenedPartsCommand = z.infer<typeof openedPartsCommandSchema>;

export const openedPartsSavedSchema = z
  .object({ openedParts: openedPartsSchema })
  .strict();

export const openedPartsResultSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("saved"), openedParts: openedPartsSchema })
    .strict(),
  z
    .object({
      kind: z.enum(["denied", "unauthorized", "unavailable", "invalid_input"]),
    })
    .strict(),
]);
export type OpenedPartsResult = z.infer<typeof openedPartsResultSchema>;
