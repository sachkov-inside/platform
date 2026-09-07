import { z } from "zod";
import { contentCoverSchema, publishedMaterialProjectionSchema } from "@/entities/material.model";
export const materialResumeSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("start") }).strict(), z.object({ kind: z.literal("position"), positionSeconds: z.number().int().positive() }).strict(), z.object({ kind: z.literal("reached-end") }).strict()]);
export const seriesContinuationProjectionSchema = z.object({
  collection: z.object({ id: z.uuid(), slug: z.string(), name: z.string(), summary: z.string().nullable(), cover: contentCoverSchema.nullable(), count: z.number().int().nonnegative(), previewItems: z.array(publishedMaterialProjectionSchema).max(3) }).strict(),
  read: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
  continuation: z.object({ materialSlug: z.string(), resume: materialResumeSchema }).strict().nullable(),
}).strict().refine((value) => value.read <= value.total && value.collection.count === value.total && (value.read < value.total || value.continuation === null));
export const seriesContinuationResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), read: z.number().int().nonnegative(), total: z.number().int().nonnegative(), continuation: z.object({ materialSlug: z.string(), label: z.string() }).strict().nullable() }).strict(),
  z.object({ kind: z.enum(["hidden", "unavailable"]) }).strict(),
]);
export type SeriesContinuationView = z.infer<typeof seriesContinuationResultSchema>;
export const seriesContinuationQueryKey = (accountId: string, slug: string) => ["reading-progress", accountId, "series-continuation", slug] as const;
export function continuationLabel(resume: z.infer<typeof materialResumeSchema>): string {
  if (resume.kind !== "position") return "Продолжить здесь";
  const total = resume.positionSeconds;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = String(total % 60).padStart(2, "0");
  return `Продолжить с ${hours > 0 ? `${String(hours)}:${String(minutes).padStart(2, "0")}` : String(minutes)}:${seconds}`;
}
