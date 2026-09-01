import { z } from "zod";

import { publishedMaterialProjectionHttpSchema } from "../../materials/index.js";

export const publishedCatalogItemHttpSchema =
  publishedMaterialProjectionHttpSchema.extend({
    availability: z.enum(["available", "locked", "unavailable"]),
  });

const publishedCatalogFacetHttpSchema = z
  .object({
    count: z.number().int().nonnegative(),
    id: z.uuid(),
    name: z.string(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120),
    summary: z.string().nullable(),
  })
  .strict();

export const publishedCatalogPageHttpSchema = z
  .object({
    facets: z
      .object({
        formats: z.array(publishedCatalogFacetHttpSchema),
        series: z.array(publishedCatalogFacetHttpSchema),
        topics: z.array(publishedCatalogFacetHttpSchema),
      })
      .strict(),
    items: z.array(publishedCatalogItemHttpSchema),
    nextCursor: z.string().min(1).max(512).nullable(),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();

const discoveryReferenceHttpSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    summary: z.string(),
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
  })
  .strict();

const discoveryTopicHttpSchema = z
  .object({ id: z.uuid(), name: z.string(), slug: z.string() })
  .strict();

export const publishedDiscoveryPageHttpSchema = z
  .object({
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
