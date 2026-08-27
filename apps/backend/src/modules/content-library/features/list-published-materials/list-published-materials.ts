import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  AccessAvailability,
  ContentAccess,
} from "../../../content-access/index.js";
import type {
  PublishedMaterialProjectionDto,
  PublishedMaterialReader,
} from "../../../materials/index.js";
import { materialId as checkedMaterialId } from "../../../materials/index.js";
import type {
  ListPublishedMaterialsQuery,
  PublishedMaterialCatalogItemDto,
  PublishedMaterialCatalogResult,
} from "./list-published-materials.contract.js";

const querySchema = z
  .object({
    subject: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("anonymous") }).strict(),
      z
        .object({ kind: z.literal("account"), accountId: z.uuid() })
        .strict(),
    ]),
    after: z.string().min(1).max(512).optional(),
    first: z.number().int().min(1).max(24),
  })
  .strict();

const cursorSchema = z
  .object({
    v: z.literal(1),
    materialId: z.uuid(),
    publishedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export async function listPublishedMaterials(
  publishedMaterialReader: Pick<PublishedMaterialReader, "listProjections">,
  contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
  query: ListPublishedMaterialsQuery,
): Promise<PublishedMaterialCatalogResult> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) {
      return { ok: false, error: { code: "invalid_request_shape" } };
    }

    const after =
      parsed.data.after === undefined
        ? undefined
        : decodeCursor(parsed.data.after);
    if (parsed.data.after !== undefined && after === undefined) {
      return { ok: false, error: { code: "invalid_request_shape" } };
    }

    const page = await publishedMaterialReader.listProjections({
      first: parsed.data.first,
      ...(after === undefined ? {} : { after }),
    });
    if (!page.ok) {
      return page;
    }

    const lastItem = page.value.items.at(-1);
    const availability =
      page.value.items.length === 0
        ? { ok: true as const, items: [] }
        : await contentAccess.checkAvailabilityMany({
            subject: query.subject,
            operations: page.value.items.map(({ materialId }) => ({
              itemId: materialId,
              resource: {
                kind: "material" as const,
                materialId: checkedMaterialId(materialId),
              },
              action: "read" as const,
            })),
            enforcementPoint: "published_material_read",
            correlationId: randomUUID(),
          });
    if (!availability.ok) {
      return {
        ok: false,
        error: { code: "internal_error", correlationId: randomUUID() },
      };
    }
    const availabilityById = new Map(
      availability.items.map((item) => [item.itemId, item]),
    );
    const items = page.value.items.map((projection) => {
      const itemAvailability = availabilityById.get(projection.materialId);
      return itemAvailability === undefined
        ? undefined
        : toCatalogItem(projection, itemAvailability.availability);
    });
    if (items.some((item) => item === undefined)) {
      return {
        ok: false,
        error: { code: "internal_error", correlationId: randomUUID() },
      };
    }
    return {
      ok: true,
      value: {
        items: items.filter(
          (item): item is PublishedMaterialCatalogItemDto => item !== undefined,
        ),
        nextCursor:
          page.value.hasNext && lastItem !== undefined
            ? encodeCursor({
                materialId: lastItem.materialId,
                publishedAt: lastItem.publishedAt,
              })
            : null,
      },
    };
}

interface PublishedMaterialCursor {
  readonly materialId: string;
  readonly publishedAt: string;
}

function decodeCursor(value: string): PublishedMaterialCursor | undefined {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success
      ? {
          materialId: parsed.data.materialId,
          publishedAt: parsed.data.publishedAt,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function encodeCursor(value: PublishedMaterialCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      materialId: value.materialId,
      publishedAt: value.publishedAt,
    }),
    "utf8",
  ).toString("base64url");
}

function toCatalogItem(
  projection: PublishedMaterialProjectionDto,
  availability: AccessAvailability["availability"],
): PublishedMaterialCatalogItemDto {
  return {
    materialId: projection.materialId,
    contentVersion: projection.contentVersion,
    slug: projection.slug,
    title: projection.title,
    summary: projection.summary,
    access: projection.access,
    availability,
    publishedAt: projection.publishedAt,
    topic: {
      id: projection.topic.id,
      name: projection.topic.name,
      slug: projection.topic.slug,
    },
    format: {
      id: projection.format.id,
      name: projection.format.name,
      slug: projection.format.slug,
    },
    tags: projection.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    seriesMemberships: projection.seriesMemberships.map(
      ({ ordinal, series }) => ({
        ordinal,
        series: {
          id: series.id,
          name: series.name,
          slug: series.slug,
        },
      }),
    ),
  };
}
