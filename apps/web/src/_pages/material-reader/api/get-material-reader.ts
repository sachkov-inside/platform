import "server-only";

import { z } from "zod";

import type {
  MaterialReaderMetadata,
  MaterialReaderResult,
} from "@/_pages/material-reader/model/material-reader-view";
import {
  BackendConnectionError,
  requestPublishedMaterial,
} from "@/shared/api/backend/index.server";
import { renderedMaterialBodySchema } from "@/entities/material";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

const projectionSchema = z.object({
  materialId: z.string(),
  contentVersion: z.number().int().positive(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  access: z.enum(["free", "membership", "workshop"]),
  publishedAt: z.iso.datetime({ offset: true }),
  primaryVideoId: z.uuid().nullable(),
  topic: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  format: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  tags: z.array(z.object({ id: z.string(), name: z.string() })),
  seriesMemberships: z.array(
    z.object({
      ordinal: z.number().int().positive(),
      series: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    }),
  ),
});

const publishedMaterialSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("available"),
    cacheScope: z.enum(["public", "private-no-store"]),
    projection: projectionSchema,
    body: renderedMaterialBodySchema,
    primaryVideo: z.object({
      failureCode: z.string().optional(),
      state: z.enum(["uploading", "processing", "ready", "failed"]),
      title: z.string(),
      videoId: z.uuid(),
    }).strict().nullable(),
  }),
  z.object({
    kind: z.literal("teaser"),
    cacheScope: z.enum(["public", "private-no-store"]),
    projection: projectionSchema,
    access: z.object({
      availability: z.literal("locked"),
      cta: z
        .object({
          label: z.literal("Получить доступ"),
          url: z.url(),
        })
        .strict(),
    }),
  }),
]);

const notFoundSchema = z.object({
  type: z.literal("urn:inside:problem:material-not-found"),
  title: z.literal("Material not found"),
  status: z.literal(404),
  code: z.literal("material_not_found"),
});

/**
 * Loads the current published Material on every RSC render.
 *
 * The slug is mutable and there is no publish-triggered Next invalidation path yet, so the
 * adapter deliberately uses `no-store`. Protected viewer-specific caching remains forbidden.
 */
export async function getMaterialReader(
  slug: string,
  accessToken?: string,
): Promise<MaterialReaderResult> {
  let result: Awaited<ReturnType<typeof requestPublishedMaterial>>;
  try {
    result = await requestPublishedMaterial(slug, {
      ...(accessToken === undefined ? {} : { accessToken }),
    });
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }

  if (!result.ok && result.response.status === 404) {
    if (!notFoundSchema.safeParse(result.problem).success) {
      throw invalidContract("Published Material 404 response does not match the contract");
    }
    return { kind: "not-found" };
  }

  if (
    !result.ok &&
    dependencyUnavailableProblemSchema.safeParse(result.problem).success
  ) {
    return { kind: "unavailable" };
  }

  if (!result.ok) {
    throw new BackendConnectionError(
      "backend-error",
      `Published Material request returned ${String(result.response.status)}`,
    );
  }

  const parsed = publishedMaterialSchema.safeParse(result.body);
  if (!parsed.success) {
    throw invalidContract("Published Material response does not match the contract", parsed.error);
  }

  const material = toMaterialMetadata(parsed.data.projection);
  return parsed.data.kind === "available"
    ? { kind: "available", material, body: parsed.data.body.blocks, primaryVideo: parsed.data.primaryVideo }
    : { kind: "access", material, cta: parsed.data.access.cta };
}

function toMaterialMetadata(
  projection: z.infer<typeof projectionSchema>,
): MaterialReaderMetadata {
  return {
    contentVersion: projection.contentVersion,
    materialId: projection.materialId,
    slug: projection.slug,
    title: projection.title,
    summary: projection.summary,
    access: projection.access,
    publishedAt: projection.publishedAt,
    topic: { name: projection.topic.name, slug: projection.topic.slug },
    format: { name: projection.format.name, slug: projection.format.slug },
    tags: projection.tags.map(({ name }) => ({ name })),
    seriesMemberships: projection.seriesMemberships.map(({ ordinal, series }) => ({
      ordinal,
      series: { name: series.name, slug: series.slug },
    })),
  };
}

function invalidContract(message: string, cause?: unknown): BackendConnectionError {
  return new BackendConnectionError("invalid-response", message, { cause });
}
