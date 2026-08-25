import { afterEach, describe, expect, it, vi } from "vitest";

import { getLibraryCatalog } from "@/_pages/library.server";

describe("Library server adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("maps a valid catalog response to the small presentation contract", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          items: [
            {
              materialId: "72000000-0000-4000-8000-000000000020",
              revisionId: "72000000-0000-4000-8000-000000000021",
              slug: "inside-platform-overview",
              title: "Как устроен Inside Platform",
              summary: "Один реальный published Material.",
              access: "membership",
              publishedAt: "2026-08-25T05:00:00.000Z",
              topic: {
                id: "72000000-0000-4000-8000-000000000002",
                name: "Platform",
                slug: "platform",
              },
              format: {
                id: "72000000-0000-4000-8000-000000000003",
                name: "Гайд",
                slug: "guide",
              },
              tags: [
                {
                  id: "72000000-0000-4000-8000-000000000004",
                  name: "Architecture",
                },
              ],
              seriesMemberships: [
                {
                  ordinal: 3,
                  series: {
                    id: "72000000-0000-4000-8000-000000000005",
                    name: "Создание Platform Inside",
                    slug: "platform-inside",
                  },
                },
              ],
            },
          ],
          nextCursor: "opaque-cursor",
        }),
      ),
    );

    await expect(getLibraryCatalog()).resolves.toEqual({
      kind: "ready",
      firstHref: null,
      items: [
        {
          slug: "inside-platform-overview",
          title: "Как устроен Inside Platform",
          summary: "Один реальный published Material.",
          access: "membership",
          topic: "Platform",
          format: "Гайд",
          tags: ["Architecture"],
          seriesMemberships: [
            { ordinal: 3, name: "Создание Platform Inside" },
          ],
        },
      ],
      nextHref: "/library?after=opaque-cursor",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://platform-api.example.test/library/materials",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("rejects a successful response outside the runtime contract", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          items: [
            {
              materialId: "72000000-0000-4000-8000-000000000020",
              revisionId: "72000000-0000-4000-8000-000000000021",
              slug: "inside-platform-overview",
              title: "Как устроен Inside Platform",
              summary: "Один реальный published Material.",
              access: "membership",
              publishedAt: "2026-08-25T05:00:00.000Z",
              topic: { id: "topic", name: "Platform", slug: "platform" },
              format: { id: "format", name: "Гайд", slug: "guide" },
              tags: [],
              seriesMemberships: [],
              body: { schemaVersion: 1, blocks: [] },
            },
          ],
          nextCursor: null,
        }),
      ),
    );

    await expect(getLibraryCatalog()).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("keeps an empty continuation recoverable from the first page", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null })),
    );

    await expect(getLibraryCatalog("page/cursor")).resolves.toEqual({
      kind: "empty",
      firstHref: "/library",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://platform-api.example.test/library/materials?after=page%2Fcursor",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("maps a dependency outage to the controlled unavailable state", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("upstream unavailable", { status: 503 })),
    );

    await expect(getLibraryCatalog()).resolves.toEqual({ kind: "unavailable" });
  });
});
