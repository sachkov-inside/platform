import "server-only";

import { z } from "zod";

import type {
  LibraryCatalogResult,
  LibraryMaterialPreview,
} from "@/_pages/library/model/library-view";
import {
  BackendConnectionError,
  requestBackend,
} from "@/shared/api/backend/index.server";

const projectionSchema = z
  .object({
    materialId: z.string(),
    revisionId: z.string(),
    slug: z.string(),
    title: z.string(),
    summary: z.string(),
    access: z.enum(["free", "membership"]),
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

export async function getLibraryCatalog(after?: string): Promise<LibraryCatalogResult> {
  let response: Response;
  try {
    response = await requestBackend(
      after === undefined
        ? "/library/materials"
        : `/library/materials?after=${encodeURIComponent(after)}`,
    );
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }

  if (response.status === 503) {
    return { kind: "unavailable" };
  }
  if (!response.ok) {
    throw new BackendConnectionError(
      "backend-error",
      `Content Library request returned ${String(response.status)}`,
    );
  }

  const parsed = catalogSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    throw new BackendConnectionError(
      "invalid-response",
      "Content Library response does not match the contract",
      { cause: parsed.error },
    );
  }
  if (parsed.data.items.length === 0) {
    return {
      kind: "empty",
      firstHref: after === undefined ? null : "/library",
    };
  }
  return {
    kind: "ready",
    firstHref: after === undefined ? null : "/library",
    items: parsed.data.items.map(toMaterialPreview),
    nextHref:
      parsed.data.nextCursor === null
        ? null
        : `/library?after=${encodeURIComponent(parsed.data.nextCursor)}`,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new BackendConnectionError(
      "invalid-response",
      "Content Library response is not valid JSON",
      { cause },
    );
  }
}

function toMaterialPreview(
  projection: z.infer<typeof projectionSchema>,
): LibraryMaterialPreview {
  return {
    slug: projection.slug,
    title: projection.title,
    summary: projection.summary,
    access: projection.access,
    topic: projection.topic.name,
    format: projection.format.name,
    tags: projection.tags.map(({ name }) => name),
    seriesMemberships: projection.seriesMemberships.map(({ ordinal, series }) => ({
      ordinal,
      name: series.name,
    })),
  };
}
