import { z } from "zod";
import { contentCoverSchema, materialPreviewSchema } from "@/entities/material.model";
export const personalHomeResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hidden") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
  z.object({ kind: z.literal("ready"), continuation: z.object({
    video: z.object({ material: materialPreviewSchema, label: z.string() }).strict().optional(),
    series: z.object({ collection: z.object({ id: z.uuid(), slug: z.string(), name: z.string(), summary: z.string().nullable(), cover: contentCoverSchema.nullable(), count: z.number().int().nonnegative(), previewItems: z.array(materialPreviewSchema).max(3) }).strict(), read: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).strict().optional(),
  }).strict() }).strict(),
]);
export type PersonalHomeResult = z.infer<typeof personalHomeResultSchema>;
export const personalHomeQueryKey = (accountId: string | null) => ["reading-progress", accountId, "continue"] as const;
