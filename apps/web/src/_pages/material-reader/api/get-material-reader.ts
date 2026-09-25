import "server-only";

import { z } from "zod";

import type {
  MaterialReaderMetadata,
  MaterialReaderResult,
  PublicMaterialResult,
} from "@/_pages/material-reader/model/material-reader-view";
import {
  BackendConnectionError,
  requestPublishedMaterial,
} from "@/shared/api/backend/index.server";
import {
  contentCoverSchema,
  renderedMaterialBodySchema,
} from "@/entities/material.model";
import { materialDifficultySchema } from "@/shared/api/material-lesson-facts";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

const projectionSchema = z.object({
  materialId: z.string(),
  contentVersion: z.number().int().positive(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  difficulty: materialDifficultySchema.nullable(),
  outcomes: z.array(z.string()),
  access: z.enum(["free", "membership", "workshop"]),
  cover: contentCoverSchema.nullable(),
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
    videoChapters: z.array(z.object({ start: z.number().int().nonnegative(), title: z.string() }).strict()).optional(),
    primaryVideo: z.object({
      durationSeconds: z.number().int().positive().optional(),
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
      subscriptionOffered: z.boolean(),
    }).strict(),
  }),
]);

const notFoundSchema = z.object({
  type: z.literal("urn:inside:problem:material_not_found"),
  title: z.literal("Material not found"),
  status: z.literal(404),
  code: z.literal("material_not_found"),
});

/**
 * Loads the current published Material as the given viewer, or as a guest without a token.
 *
 * The adapter itself never caches. The guest read is cached one level up, in
 * `public-material.public-cache.server.ts`; a read with a token stays uncached (ADR 0027).
 */
export async function getMaterialReader(
  slug: string,
  accessToken?: string,
): Promise<MaterialReaderResult> {
  return (await readPublishedMaterial(slug, accessToken)).result;
}

/**
 * Урок глазами гостя — то, что можно держать в общем кеше. Тело остаётся только у ответа, который
 * backend сам пометил `cacheScope: "public"`; предложение о покупке сюда не попадает: оно
 * принадлежит личной части.
 */
export async function getGuestMaterial(slug: string): Promise<PublicMaterialResult> {
  const { publicScope, result } = await readPublishedMaterial(slug);
  if (result.kind === "access") return { kind: "teaser", material: result.material };
  // Гость не должен получать закрытое тело; если контракт это нарушил, в кеш оно всё равно не идёт.
  if (result.kind === "available" && !publicScope) {
    return { kind: "teaser", material: result.material };
  }
  return result;
}

async function readPublishedMaterial(
  slug: string,
  accessToken?: string,
): Promise<{ readonly publicScope: boolean; readonly result: MaterialReaderResult }> {
  let result: Awaited<ReturnType<typeof requestPublishedMaterial>>;
  try {
    result = await requestPublishedMaterial(slug, {
      ...(accessToken === undefined ? {} : { accessToken }),
    });
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { publicScope: false, result: { kind: "unavailable" } };
    }
    throw error;
  }

  if (!result.ok && result.response.status === 404) {
    if (!notFoundSchema.safeParse(result.problem).success) {
      throw invalidContract("Published Material 404 response does not match the contract");
    }
    return { publicScope: false, result: { kind: "not-found" } };
  }

  if (
    !result.ok &&
    dependencyUnavailableProblemSchema.safeParse(result.problem).success
  ) {
    return { publicScope: false, result: { kind: "unavailable" } };
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
  return {
    publicScope: parsed.data.cacheScope === "public",
    result: parsed.data.kind === "available"
      ? { kind: "available", material, body: parsed.data.body.blocks, primaryVideo: parsed.data.primaryVideo === null ? null : { ...parsed.data.primaryVideo, ...(parsed.data.videoChapters === undefined ? {} : { chapters: parsed.data.videoChapters }) } }
      : {
          kind: "access",
          material,
          subscriptionOffered: parsed.data.access.subscriptionOffered,
        },
  };
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
    difficulty: projection.difficulty,
    outcomes: projection.outcomes,
    access: projection.access,
    cover: projection.cover,
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
