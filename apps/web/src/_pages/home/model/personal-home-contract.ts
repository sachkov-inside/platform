import { z } from "zod";
export const personalHomeResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hidden") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
  z.object({ kind: z.literal("ready"), items: z.array(z.object({
    id: z.uuid(), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u), title: z.string(), format: z.string(),
    resume: z.discriminatedUnion("kind", [z.object({ kind: z.literal("start") }).strict(), z.object({ kind: z.literal("position"), positionSeconds: z.number().nonnegative() }).strict(), z.object({ kind: z.literal("reached-end") }).strict()]),
  }).strict()).max(6) }).strict(),
]);
export const personalHomeQueryKey = (accountId: string | null) => ["reading-progress", accountId, "continue"] as const;
