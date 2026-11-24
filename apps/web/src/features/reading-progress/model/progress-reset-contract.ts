import { z } from "zod";

/** Starts a chapter over: its Materials lose their studied marks and opened lesson parts. */
export const progressResetCommandSchema = z
  .object({
    materialIds: z.array(z.uuid()).min(1).max(100),
    commandId: z.uuid(),
  })
  .strict();
export type ProgressResetCommand = z.infer<typeof progressResetCommandSchema>;

export const progressResetSavedSchema = z
  .object({
    resetCount: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict();

export const progressResetResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("reset"),
      resetCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.enum(["unauthorized", "unavailable", "invalid_input"]),
    })
    .strict(),
]);
export type ProgressResetResult = z.infer<typeof progressResetResultSchema>;
