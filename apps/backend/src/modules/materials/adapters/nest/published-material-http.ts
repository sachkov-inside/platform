import { z } from "zod";

import { renderedBlockSchema } from "./material-authoring-http.js";

const referenceSchema = z
  .object({ id: z.string(), name: z.string(), slug: z.string() })
  .strict();

export const publishedMaterialProjectionHttpSchema = z
  .object({
    materialId: z.string(),
    contentVersion: z.number().int().positive(),
    slug: z.string(),
    title: z.string(),
    summary: z.string(),
    access: z.enum(["free", "membership"]),
    publishedAt: z.iso.datetime({ offset: true }),
    topic: referenceSchema,
    format: referenceSchema,
    tags: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    seriesMemberships: z.array(
      z
        .object({ ordinal: z.number().int().positive(), series: referenceSchema })
        .strict(),
    ),
  })
  .strict();

export const publishedMaterialReadHttpSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("available"),
      cacheScope: z.enum(["public", "private-no-store"]),
      projection: publishedMaterialProjectionHttpSchema,
      body: z.object({ schemaVersion: z.literal(1), blocks: z.array(renderedBlockSchema) }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("teaser"),
      cacheScope: z.enum(["public", "private-no-store"]),
      projection: publishedMaterialProjectionHttpSchema,
      access: z
        .object({
          availability: z.literal("locked"),
          cta: z
            .object({
              label: z.literal("Получить доступ"),
              url: z.url(),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
]);

export const publishedMaterialProblemHttpSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    retryable: z.boolean().optional(),
    correlationId: z.string().optional(),
  })
  .strict();
