import { z } from "zod";
export const materialOpenCommandSchema = z.object({ materialId: z.uuid(), contentVersion: z.number().int().positive(), commandId: z.uuid() }).strict();
export type MaterialOpenCommand = z.infer<typeof materialOpenCommandSchema>;
export const materialOpenResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), openedAt: z.iso.datetime(), replayed: z.boolean() }).strict(),
  z.object({ kind: z.enum(["denied", "unauthorized", "unavailable", "invalid_input", "conflict"]) }).strict(),
]);
