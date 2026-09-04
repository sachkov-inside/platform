import { z } from "zod";

import type { MaterialPreview } from "./material-preview";
import { contentCoverSchema } from "./content-cover";

export const materialPreviewSchema: z.ZodType<MaterialPreview> = z
  .object({
    access: z.enum(["free", "membership", "workshop"]),
    availability: z.enum(["available", "locked", "unavailable"]),
    cover: contentCoverSchema.nullable().optional(),
    format: z.string(),
    formatSlug: z.string().optional(),
    primaryVideoDurationSeconds: z.number().int().positive().optional(),
    seriesMemberships: z.array(
      z
        .object({
          name: z.string(),
          ordinal: z.number().int().positive(),
          slug: z.string(),
        })
        .strict(),
    ),
    slug: z.string(),
    summary: z.string(),
    tags: z.array(z.string()),
    title: z.string(),
    topic: z.string(),
    topicSlug: z.string(),
  })
  .strict();

export const publishedMaterialProjectionSchema = z
  .object({
    access: z.enum(["free", "membership", "workshop"]),
    availability: z.enum(["available", "locked", "unavailable"]),
    contentVersion: z.number().int().positive(),
    cover: contentCoverSchema.nullable(),
    format: z
      .object({ id: z.string(), name: z.string(), slug: z.string() })
      .strict(),
    materialId: z.string(),
    primaryVideoDurationSeconds: z.number().int().positive().optional(),
    primaryVideoId: z.string().nullable(),
    publishedAt: z.iso.datetime({ offset: true }),
    seriesMemberships: z.array(
      z
        .object({
          ordinal: z.number().int().positive(),
          series: z
            .object({ id: z.string(), name: z.string(), slug: z.string() })
            .strict(),
        })
        .strict(),
    ),
    slug: z.string(),
    summary: z.string(),
    tags: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    title: z.string(),
    topic: z
      .object({ id: z.string(), name: z.string(), slug: z.string() })
      .strict(),
  })
  .strict();

export function toMaterialPreview(
  projection: z.infer<typeof publishedMaterialProjectionSchema>,
): MaterialPreview {
  return {
    access: projection.access,
    availability: projection.availability,
    cover: projection.cover,
    format: projection.format.name,
    formatSlug: projection.format.slug,
    ...(projection.primaryVideoDurationSeconds === undefined
      ? {}
      : {
          primaryVideoDurationSeconds:
            projection.primaryVideoDurationSeconds,
        }),
    seriesMemberships: projection.seriesMemberships.map(
      ({ ordinal, series }) => ({
        name: series.name,
        ordinal,
        slug: series.slug,
      }),
    ),
    slug: projection.slug,
    summary: projection.summary,
    tags: projection.tags.map(({ name }) => name),
    title: projection.title,
    topic: projection.topic.name,
    topicSlug: projection.topic.slug,
  };
}
