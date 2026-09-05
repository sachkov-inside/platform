import { describe, expect, it, vi } from "vitest";

import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { projectPublishedCatalogItems } from "../../src/modules/content-library/shared/project-published-catalog-items.js";
import type { PublishedMaterialProjectionDto } from "../../src/modules/materials/index.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";

describe("Published catalog item projection", () => {
  it("adds the ready primary Video duration through the Videos interface", async () => {
    const videoId = "75000000-0000-4000-8000-000000000001";
    const source = { ...projection(1), primaryVideoId: videoId };
    const loadReadyDurations = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: [{ durationSeconds: 600, videoId }],
      }),
    );
    const result = await projectPublishedCatalogItems(
      {
        checkAvailabilityMany: ({ operations }) =>
          Promise.resolve({
            ok: true,
            items: operations.map(({ itemId }) => ({
              availability: "available" as const,
              itemId,
            })),
          }),
      },
      { loadReadyDurations },
      anonymousSubject,
      [source],
    );

    expect(result).toMatchObject({
      ok: true,
      items: [{ primaryVideoDurationSeconds: 600 }],
    });
    expect(loadReadyDurations).toHaveBeenCalledWith([videoId]);
  });

  it("checks complete Playlists in bounded batches while preserving author order", async () => {
    const projections = Array.from({ length: 101 }, (_, index) =>
      projection(index + 1),
    );
    const checkAvailabilityMany = vi.fn(
      ({ operations }: { readonly operations: readonly { readonly itemId: string }[] }) => Promise.resolve({
        ok: true as const,
        items: operations.map(({ itemId }) => ({
          availability: "available" as const,
          itemId,
        })),
      }),
    );

    const result = await projectPublishedCatalogItems(
      { checkAvailabilityMany },
      emptyCatalogVideos,
      anonymousSubject,
      projections,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error.code);
    expect(checkAvailabilityMany).toHaveBeenCalledTimes(2);
    expect(checkAvailabilityMany.mock.calls.map(([input]) => input.operations.length)).toEqual([
      100,
      1,
    ]);
    expect(result.items.map(({ materialId }) => materialId)).toEqual(
      projections.map(({ materialId }) => materialId),
    );
  });
});

function projection(ordinal: number): PublishedMaterialProjectionDto {
  const suffix = String(ordinal).padStart(12, "0");
  return {
    access: "free",
    cover: null,
    contentVersion: 1,
    format: {
      id: "71000000-0000-4000-8000-000000000001",
      name: "Гайд",
      slug: "guide",
    },
    materialId: `72000000-0000-4000-8000-${suffix}`,
    primaryVideoId: null,
    publishedAt: "2026-09-02T00:00:00.000Z",
    seriesMemberships: [
      {
        ordinal,
        series: {
          id: "73000000-0000-4000-8000-000000000001",
          name: "Полный плейлист",
          slug: "complete-playlist",
        },
      },
    ],
    slug: `material-${String(ordinal)}`,
    summary: "Safe teaser.",
    tags: [],
    title: `Материал ${String(ordinal)}`,
    topic: {
      id: "74000000-0000-4000-8000-000000000001",
      name: "Platform",
      slug: "platform",
    },
  };
}
