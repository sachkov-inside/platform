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
import type { Videos } from "../../videos/index.js";
import type { PublishedMaterialCatalogItemDto } from "../features/list-published-materials/list-published-materials.contract.js";

const CONTENT_ACCESS_BATCH_SIZE = 100;

export type PublishedCatalogItemsResult =
  | {
      readonly ok: true;
      readonly items: readonly PublishedMaterialCatalogItemDto[];
    }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "dependency_unavailable"; readonly retryable: true }
        | { readonly code: "internal_error"; readonly correlationId: string };
    };

export async function projectPublishedCatalogItems(
  contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
  videos: Pick<Videos, "loadReadyDurations">,
  subject: Subject,
  projections: readonly PublishedMaterialProjectionDto[],
): Promise<PublishedCatalogItemsResult> {
  if (projections.length === 0) {
    return { ok: true, items: [] };
  }
  const durations = await loadCatalogDurations(
    videos,
    projections.flatMap(({ primaryVideoId }) =>
      primaryVideoId === null ? [] : [primaryVideoId],
    ),
  );
  if (!durations.ok) return durations;
  const projected = await projectPublishedCatalogAvailability(
    contentAccess,
    subject,
    projections,
  );
  return projected.ok
    ? { ok: true, items: withDurations(projected.items, durations.value) }
    : projected;
}

async function loadCatalogDurations(
  videos: Pick<Videos, "loadReadyDurations">,
  videoIds: readonly string[],
): Promise<
  | { readonly ok: true; readonly value: ReadonlyMap<string, number> }
  | Extract<PublishedCatalogItemsResult, { readonly ok: false }>
> {
  const durations = await videos.loadReadyDurations(videoIds);
  if (!durations.ok) {
    return durations.error.code === "dependency_unavailable"
      ? {
          ok: false,
          error: { code: "dependency_unavailable", retryable: true },
        }
      : internalError();
  }
  return {
    ok: true as const,
    value: new Map(
      durations.value.map(({ durationSeconds, videoId }) => [
        videoId,
        durationSeconds,
      ]),
    ),
  };
}

function withDurations(
  items: readonly PublishedMaterialCatalogItemDto[],
  durationByVideoId: ReadonlyMap<string, number>,
): readonly PublishedMaterialCatalogItemDto[] {
  return items.map((item) => {
    const duration =
      item.primaryVideoId === null
        ? undefined
        : durationByVideoId.get(item.primaryVideoId);
    return duration === undefined
      ? item
      : { ...item, primaryVideoDurationSeconds: duration };
  });
}

/** Add durations only for the catalog items the caller will show or resume. */
export async function addPublishedCatalogDurations(
  videos: Pick<Videos, "loadReadyDurations">,
  items: readonly PublishedMaterialCatalogItemDto[],
): Promise<PublishedCatalogItemsResult> {
  if (items.length === 0) return { ok: true, items: [] };
  const durations = await loadCatalogDurations(videos, [
    ...new Set(
      items.flatMap(({ primaryVideoId }) =>
        primaryVideoId === null ? [] : [primaryVideoId],
      ),
    ),
  ]);
  return durations.ok
    ? { ok: true, items: withDurations(items, durations.value) }
    : durations;
}

/** ContentLibrary owns availability and catalog mapping independently of durations. */
export async function projectPublishedCatalogAvailability(
  contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
  subject: Subject,
  projections: readonly PublishedMaterialProjectionDto[],
): Promise<PublishedCatalogItemsResult> {
  const availabilityItems: AccessAvailability[] = [];
  for (
    let start = 0;
    start < projections.length;
    start += CONTENT_ACCESS_BATCH_SIZE
  ) {
    const batch = projections.slice(start, start + CONTENT_ACCESS_BATCH_SIZE);
    const availability = await contentAccess.checkAvailabilityMany({
      subject,
      operations: batch.map(({ materialId }) => ({
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
    availabilityItems.push(...availability.items);
  }
  const availabilityById = new Map(
    availabilityItems.map((item) => [item.itemId, item]),
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
    ...(availability !== "available" || projection.noteExcerpt === undefined
      ? {}
      : { noteExcerpt: projection.noteExcerpt }),
    difficulty: projection.difficulty,
    outcomes: projection.outcomes,
    access: projection.access,
    availability,
    publishedAt: projection.publishedAt,
    primaryVideoId: projection.primaryVideoId,
    cover: projection.cover,
    topic: { ...projection.topic },
    format: { ...projection.format },
    tags: projection.tags.map((tag) => ({ ...tag })),
    seriesMemberships: projection.seriesMemberships.map(
      ({ ordinal, series, stepGroup }) => ({
        ordinal,
        series: { ...series },
        ...(stepGroup === undefined ? {} : { stepGroup }),
      }),
    ),
  };
}

function internalError(): Extract<
  PublishedCatalogItemsResult,
  { readonly ok: false }
> {
  return {
    ok: false,
    error: { code: "internal_error", correlationId: randomUUID() },
  };
}
