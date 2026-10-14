import { describe, expect, it, vi } from "vitest";

import type { ContentAccess } from "../../src/modules/content-access/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import {
  projectPublishedCatalogAvailability,
  addPublishedCatalogDurations,
} from "../../src/modules/content-library/index.js";
import { projectPublishedCatalogItems } from "../../src/modules/content-library/shared/project-published-catalog-items.js";
import { listPublishedMaterials } from "../../src/modules/content-library/features/list-published-materials/list-published-materials.js";
import { publishedCatalogPageHttpSchema } from "../../src/modules/content-library/shared/published-catalog-http.js";
import type { PublishedMaterialProjectionDto } from "../../src/modules/materials/index.js";

describe("Published catalog item projection", () => {
  it("accepts its title continuation for a maximum multilingual title", async () => {
    const title = "界".repeat(160);
    const material = {
      ...projection(1),
      title,
      format: { id: "guide", name: "Гайд", slug: "guide" },
    };
    const listProjections = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          continuation: {
            kind: "title" as const,
            materialId: material.materialId,
            title,
          },
          facets: { formats: [], series: [], topics: [] },
          hasNext: true,
          items: [material],
          totalCount: 2,
        },
      }),
    );
    const contentAccess = {
      checkAvailabilityMany: ({
        operations,
      }: Parameters<ContentAccess["checkAvailabilityMany"]>[0]) =>
        Promise.resolve({
          ok: true as const,
          items: operations.map(({ itemId }) => ({
            itemId,
            availability: "available" as const,
          })),
        }),
    };
    const videos = {
      loadReadyDurations: () =>
        Promise.resolve({ ok: true as const, value: [] }),
    };
    const query = {
      subject: anonymousSubject,
      first: 1,
      sort: "title" as const,
    };
    const first = await listPublishedMaterials(
      { listProjections },
      contentAccess,
      videos,
      query,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.code);
    const parsedPage = publishedCatalogPageHttpSchema.safeParse(first.value);
    expect(parsedPage.error?.issues).toBeUndefined();
    const after = first.value.nextCursor;
    if (after === null) throw new Error("Expected continuation");
    const next = await listPublishedMaterials(
      { listProjections },
      contentAccess,
      videos,
      { ...query, after },
    );
    expect(next.ok).toBe(true);
    expect(listProjections).toHaveBeenLastCalledWith(
      expect.objectContaining({
        after: { kind: "title", materialId: material.materialId, title },
      }),
    );
  });

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

  it("adds durations once per unique video while keeping locked excerpts private", async () => {
    const videoId = "75000000-0000-4000-8000-000000000001";
    const projected = await projectPublishedCatalogAvailability(
      {
        checkAvailabilityMany: ({ operations }) =>
          Promise.resolve({
            ok: true,
            items: operations.map(({ itemId }, index) => ({
              itemId,
              availability:
                index === 0 ? ("available" as const) : ("locked" as const),
            })),
          }),
      },
      anonymousSubject,
      [
        {
          ...projection(1),
          primaryVideoId: videoId,
          noteExcerpt: { text: "Visible", truncated: false },
        },
        {
          ...projection(2),
          primaryVideoId: videoId,
          noteExcerpt: { text: "Private", truncated: false },
        },
        projection(3),
      ],
    );
    if (!projected.ok) throw new Error(projected.error.code);
    expect(projected.items[0]).toMatchObject({
      noteExcerpt: { text: "Visible", truncated: false },
    });
    expect(projected.items[1]).not.toHaveProperty("noteExcerpt");
    const loadReadyDurations = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: [{ videoId, durationSeconds: 600 }],
      }),
    );
    const result = await addPublishedCatalogDurations(
      { loadReadyDurations },
      projected.items,
    );
    expect(loadReadyDurations).toHaveBeenCalledExactlyOnceWith([videoId]);
    expect(result).toMatchObject({
      ok: true,
      items: [
        {
          materialId: projection(1).materialId,
          primaryVideoDurationSeconds: 600,
        },
        {
          materialId: projection(2).materialId,
          primaryVideoDurationSeconds: 600,
        },
        { materialId: projection(3).materialId },
      ],
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.items[2]).not.toHaveProperty("primaryVideoDurationSeconds");
  });

  it("rejects failed or incomplete availability instead of publishing a partial catalog", async () => {
    for (const response of [
      {
        ok: false as const,
        error: {
          code: "batch_too_large" as const,
        },
      },
      { ok: true as const, items: [] },
    ]) {
      expect(
        await projectPublishedCatalogAvailability(
          { checkAvailabilityMany: () => Promise.resolve(response) },
          anonymousSubject,
          [projection(1)],
        ),
      ).toMatchObject({ ok: false, error: { code: "internal_error" } });
    }
  });

  it("checks complete Playlists in bounded batches while preserving author order", async () => {
    const projections = Array.from({ length: 101 }, (_, index) =>
      projection(index + 1),
    );
    const checkAvailabilityMany = vi.fn(
      ({
        operations,
      }: {
        readonly operations: readonly { readonly itemId: string }[];
      }) =>
        Promise.resolve({
          ok: true as const,
          items: operations.map(({ itemId }) => ({
            availability: "available" as const,
            itemId,
          })),
        }),
    );

    const result = await projectPublishedCatalogAvailability(
      { checkAvailabilityMany },
      anonymousSubject,
      projections,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error.code);
    expect(checkAvailabilityMany).toHaveBeenCalledTimes(2);
    expect(
      checkAvailabilityMany.mock.calls.map(
        ([input]) => input.operations.length,
      ),
    ).toEqual([100, 1]);
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
    difficulty: null,
    outcomes: [],
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
