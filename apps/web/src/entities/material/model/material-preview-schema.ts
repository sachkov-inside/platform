import { z } from "zod";

import type { MaterialPreview } from "./material-preview";

export const materialPreviewSchema: z.ZodType<MaterialPreview> = z
  .object({
    access: z.enum(["free", "membership"]),
    availability: z.enum(["available", "locked", "unavailable"]),
    format: z.string(),
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
    access: z.enum(["free", "membership"]),
    availability: z.enum(["available", "locked", "unavailable"]),
    contentVersion: z.number().int().positive(),
    format: z
      .object({ id: z.string(), name: z.string(), slug: z.string() })
      .strict(),
    materialId: z.string(),
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
    format: projection.format.name,
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
