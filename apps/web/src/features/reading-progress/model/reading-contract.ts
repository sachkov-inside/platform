import { z } from "zod";
export const readingStateSchema = z.object({ materialId: z.uuid(), isRead: z.boolean(), readAt: z.iso.datetime().nullable(), updatedAt: z.iso.datetime().nullable(), version: z.number().int().nonnegative() }).strict();
export type ReadingState = z.infer<typeof readingStateSchema>;
export const readingCommandSchema = z.object({ materialId: z.uuid(), commandId: z.uuid(), expectedVersion: z.number().int().nonnegative().max(2_147_483_646), isRead: z.boolean() }).strict();
export type ReadingCommand = z.infer<typeof readingCommandSchema>;
export const readingResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), state: readingStateSchema, replayed: z.boolean() }).strict(),
  z.object({ kind: z.literal("conflict"), current: readingStateSchema.nullable() }).strict(),
  z.object({ kind: z.enum(["unavailable", "unauthorized", "denied", "invalid_input"]) }).strict(),
]);
export const readingStatesResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), states: z.array(readingStateSchema).max(100) }).strict(),
  z.object({ kind: z.enum(["unavailable", "unauthorized", "invalid_input"]) }).strict(),
]);
