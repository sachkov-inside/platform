import { z } from "zod";


import {
  materialFormatSchema,
  contentCoverProjectionHttpSchema,
  publishedMaterialProjectionHttpSchema,
} from "../../materials/index.js";

export const publishedCatalogItemHttpSchema =
  publishedMaterialProjectionHttpSchema.extend({
    availability: z.enum(["available", "locked", "unavailable"]),
    primaryVideoDurationSeconds: z.number().int().positive().optional(),
  });

export const publishedCatalogFacetHttpSchema = z
  .object({
    count: z.number().int().nonnegative(),
    id: z.uuid(),
    name: z.string(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120),
    summary: z.string().nullable(),
    cover: contentCoverProjectionHttpSchema.nullable(),
    previewItems: z.array(publishedCatalogItemHttpSchema),
  })
  .strict();

export const publishedCatalogPageHttpSchema = z
  .object({
    facets: z
      .object({
        formats: z.array(publishedCatalogFacetHttpSchema.extend({ id: materialFormatSchema, slug: materialFormatSchema })),
        series: z.array(publishedCatalogFacetHttpSchema),
        topics: z.array(publishedCatalogFacetHttpSchema),
      })
      .strict(),
    items: z.array(publishedCatalogItemHttpSchema),
    nextCursor: z.string().min(1).max(512).nullable(),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();

const guideIntroductionHttpSchema = z
  .object({
    audience: z.string(),
    outcome: z.string(),
    prerequisites: z.string(),
    scope: z.string(),
  })
  .strict();

const discoveryReferenceHttpSchema = z
  .object({
    id: z.uuid(),
    introduction: guideIntroductionHttpSchema.nullable(),
    name: z.string(),
    slug: z.string(),
    summary: z.string(),
    cover: contentCoverProjectionHttpSchema.nullable(),
  })
  .strict();

const relatedSeriesHttpSchema = z
  .object({
    id: z.uuid(),
    matchingMaterialCount: z.number().int().nonnegative(),
    name: z.string(),
    slug: z.string(),
    summary: z.string(),
    totalMaterialCount: z.number().int().nonnegative(),
    cover: contentCoverProjectionHttpSchema.nullable(),
  })
  .strict();

const discoveryTopicHttpSchema = z
  .object({
    cover: contentCoverProjectionHttpSchema.nullable(),
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

const guideChapterHttpSchema = z
  .object({
    id: z.uuid(),
    materialIds: z.array(z.uuid()),
    name: z.string(),
  })
  .strict();

export const publishedDiscoveryPageHttpSchema = z
  .object({
    chapters: z.array(guideChapterHttpSchema),
    hasNext: z.boolean(),
    items: z.array(publishedCatalogItemHttpSchema),
    kind: z.enum(["related", "series", "topic"]),
    reference: discoveryReferenceHttpSchema,
    relatedSeries: z.array(relatedSeriesHttpSchema),
    topics: z.array(discoveryTopicHttpSchema),
  })
  .strict();

export const publishedTopicPageHttpSchema =
  publishedDiscoveryPageHttpSchema.extend({ kind: z.literal("topic") });
export const publishedSeriesPageHttpSchema =
  publishedDiscoveryPageHttpSchema.extend({ kind: z.literal("series") });
export const relatedPublishedMaterialsHttpSchema =
  publishedDiscoveryPageHttpSchema.extend({ kind: z.literal("related") });
