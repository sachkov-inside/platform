import { randomUUID } from "node:crypto";

import type {
  AccessAvailability,
  ContentAccess,
  Subject,
} from "../../content-access/index.js";
import {
  materialId as checkedMaterialId,
  type PublishedMaterialProjectionDto,
} from "../../materials/index.js";
import type { PublishedMaterialCatalogItemDto } from "../features/list-published-materials/list-published-materials.contract.js";

export type PublishedCatalogItemsResult =
  | { readonly ok: true; readonly items: readonly PublishedMaterialCatalogItemDto[] }
  | {
      readonly ok: false;
      readonly error: { readonly code: "internal_error"; readonly correlationId: string };
    };

export async function projectPublishedCatalogItems(
  contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
  subject: Subject,
  projections: readonly PublishedMaterialProjectionDto[],
): Promise<PublishedCatalogItemsResult> {
  if (projections.length === 0) {
    return { ok: true, items: [] };
  }
  const availability = await contentAccess.checkAvailabilityMany({
    subject,
    operations: projections.map(({ materialId }) => ({
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
    return internalError();
  }
  const availabilityById = new Map(
    availability.items.map((item) => [item.itemId, item]),
  );
  const items = projections.map((projection) => {
    const itemAvailability = availabilityById.get(projection.materialId);
    return itemAvailability === undefined
      ? undefined
      : toCatalogItem(projection, itemAvailability.availability);
  });
  return items.some((item) => item === undefined)
    ? internalError()
    : {
        ok: true,
        items: items.filter(
          (item): item is PublishedMaterialCatalogItemDto => item !== undefined,
        ),
      };
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
    topic: { ...projection.topic },
    format: { ...projection.format },
    tags: projection.tags.map((tag) => ({ ...tag })),
    seriesMemberships: projection.seriesMemberships.map(
      ({ ordinal, series }) => ({ ordinal, series: { ...series } }),
    ),
  };
}

function internalError(): Extract<PublishedCatalogItemsResult, { readonly ok: false }> {
  return {
    ok: false,
    error: { code: "internal_error", correlationId: randomUUID() },
  };
}
