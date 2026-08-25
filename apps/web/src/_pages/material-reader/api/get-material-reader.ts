import "server-only";

import { z } from "zod";

import type {
  MaterialReaderMetadata,
  MaterialReaderResult,
  ReaderBlock,
  ReaderMark,
  ReaderText,
} from "@/_pages/material-reader/model/material-reader-view";
import {
  BackendConnectionError,
  requestBackend,
} from "@/shared/api/backend/index.server";

const readerMarkSchema: z.ZodType<ReaderMark> = z.union([
  z.object({ kind: z.enum(["bold", "code", "italic", "strike"]) }),
  z.object({ kind: z.literal("link"), href: z.string() }),
]);

const readerTextSchema: z.ZodType<ReaderText> = z.object({
  kind: z.literal("text"),
  text: z.string(),
  marks: z.array(readerMarkSchema),
});

const readerBlockSchema: z.ZodType<ReaderBlock> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("paragraph"), content: z.array(readerTextSchema) }),
    z.object({
      kind: z.literal("heading"),
      level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      content: z.array(readerTextSchema),
    }),
    z.object({ kind: z.literal("bullet_list"), items: z.array(z.array(readerBlockSchema)) }),
    z.object({ kind: z.literal("ordered_list"), items: z.array(z.array(readerBlockSchema)) }),
    z.object({ kind: z.literal("blockquote"), content: z.array(readerBlockSchema) }),
    z.object({ kind: z.literal("code_block"), text: z.string() }),
    z.object({ kind: z.literal("horizontal_rule") }),
    z.object({
      kind: z.literal("table"),
      rows: z.array(
        z.object({
          cells: z.array(
            z.object({
              header: z.boolean(),
              content: z.array(readerBlockSchema),
            }),
          ),
        }),
      ),
    }),
    z.object({
      kind: z.literal("callout"),
      tone: z.enum(["note", "tip", "warning"]),
      content: z.array(readerBlockSchema),
    }),
    z.object({
      kind: z.literal("image"),
      assetId: z.string(),
      alt: z.string(),
      caption: z.string().optional(),
    }),
    z.object({ kind: z.literal("file"), assetId: z.string(), label: z.string() }),
    z.object({
      kind: z.literal("video"),
      videoId: z.string(),
      caption: z.string().optional(),
    }),
  ]),
);

const projectionSchema = z.object({
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
});

const publishedMaterialSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("available"),
    cacheScope: z.enum(["public", "private-no-store"]),
    projection: projectionSchema,
    body: z.object({ schemaVersion: z.literal(1), blocks: z.array(readerBlockSchema) }),
  }),
  z.object({
    kind: z.literal("teaser"),
    cacheScope: z.enum(["public", "private-no-store"]),
    projection: projectionSchema,
    access: z.object({
      allowed: z.literal(false),
      reason: z.enum(["forbidden", "membership_required", "temporarily_unavailable"]),
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
 * Loads the current published revision on every RSC render.
 *
 * The slug is mutable and there is no publish-triggered Next invalidation path yet, so the
 * adapter deliberately uses `no-store`. Protected viewer-specific caching remains forbidden.
 */
export async function getMaterialReader(slug: string): Promise<MaterialReaderResult> {
  let response: Response;
  try {
    response = await requestBackend(`/materials/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }

  if (response.status === 404) {
    const payload = await readJson(response);
    if (!notFoundSchema.safeParse(payload).success) {
      throw invalidContract("Published Material 404 response does not match the contract");
    }
    return { kind: "not-found" };
  }

  if (response.status === 503) {
    return { kind: "unavailable" };
  }

  if (!response.ok) {
    throw new BackendConnectionError(
      "backend-error",
      `Published Material request returned ${String(response.status)}`,
    );
  }

  const payload = await readJson(response);
  const parsed = publishedMaterialSchema.safeParse(payload);
  if (!parsed.success) {
    throw invalidContract("Published Material response does not match the contract", parsed.error);
  }

  const material = toMaterialMetadata(parsed.data.projection);
  return parsed.data.kind === "available"
    ? { kind: "available", material, body: parsed.data.body.blocks }
    : { kind: "access", material, reason: parsed.data.access.reason };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw invalidContract("Published Material response is not valid JSON", cause);
  }
}

function toMaterialMetadata(
  projection: z.infer<typeof projectionSchema>,
): MaterialReaderMetadata {
  return {
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
