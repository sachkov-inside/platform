import "server-only";

import { z } from "zod";

import type {
  LibraryCatalogPage,
  LibraryMaterialPreview,
} from "@/_pages/library/model/library-view";
import {
  BackendConnectionError,
  requestPublishedMaterialCatalog,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

const projectionSchema = z
  .object({
    materialId: z.string(),
    contentVersion: z.number().int().positive(),
    slug: z.string(),
    title: z.string(),
    summary: z.string(),
    access: z.enum(["free", "membership"]),
    availability: z.enum(["available", "locked", "unavailable"]),
    publishedAt: z.iso.datetime({ offset: true }),
    topic: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    format: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    tags: z.array(z.object({ id: z.string(), name: z.string() })),
    seriesMemberships: z.array(
      z.object({
        ordinal: z.number().int().positive(),
        series: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
      }),
    ),
  })
  .strict();

const catalogSchema = z
  .object({
    items: z.array(projectionSchema),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();

export async function getLibraryCatalogPage(
  after: string | undefined,
  accessToken?: string,
  signal?: AbortSignal,
): Promise<LibraryCatalogPage> {
  let result: Awaited<ReturnType<typeof requestPublishedMaterialCatalog>>;
  try {
    result = await requestPublishedMaterialCatalog(after, {
      ...(accessToken === undefined ? {} : { accessToken }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }

  if (!result.ok) {
    if (dependencyUnavailableProblemSchema.safeParse(result.problem).success) {
      return { kind: "unavailable" };
    }
    throw new BackendConnectionError(
      "backend-error",
      `Content Library request returned ${String(result.response.status)}`,
    );
  }

  const parsed = catalogSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new BackendConnectionError(
      "invalid-response",
      "Content Library response does not match the contract",
      { cause: parsed.error },
    );
  }
  if (parsed.data.items.length === 0) {
    return after === undefined
      ? { kind: "empty" }
      : { kind: "ready", items: [], nextCursor: null };
  }
  return {
    kind: "ready",
    items: parsed.data.items.map(toMaterialPreview),
    nextCursor: parsed.data.nextCursor,
  };
}

function toMaterialPreview(
  projection: z.infer<typeof projectionSchema>,
): LibraryMaterialPreview {
  return {
    slug: projection.slug,
    title: projection.title,
    summary: projection.summary,
    access: projection.access,
    availability: projection.availability,
    topic: projection.topic.name,
    format: projection.format.name,
    tags: projection.tags.map(({ name }) => name),
    seriesMemberships: projection.seriesMemberships.map(({ ordinal, series }) => ({
      ordinal,
      name: series.name,
    })),
  };
}
