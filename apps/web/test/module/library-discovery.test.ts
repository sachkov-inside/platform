import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPublishedSeries,
  getPublishedTopic,
  getRelatedMaterials,
} from "@/_pages/library-discovery.server";

const publishedProjection = {
  materialId: "72000000-0000-4000-8000-000000000020",
  contentVersion: 3,
  slug: "inside-platform-overview",
  title: "Как устроен Inside Platform",
  summary: "Один реальный published Material.",
  access: "membership",
  availability: "locked",
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
} as const;

describe("Library discovery server adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ["topic", getPublishedTopic, "/library/topics/platform"],
    ["series", getPublishedSeries, "/library/series/platform"],
  ] as const)(
    "maps a valid %s response to canonical navigation metadata",
    async (kind, getDiscovery, expectedPath) => {
      vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            hasNext: false,
            items: [publishedProjection],
            kind,
            reference: {
              id: "72000000-0000-4000-8000-000000000002",
              name: "Platform",
              slug: "platform",
            },
          }),
        ),
      );

      await expect(getDiscovery("platform")).resolves.toEqual({
        discoveryKind: kind,
        hasNext: false,
        items: [
          {
            access: "membership",
            availability: "locked",
            format: "Гайд",
            seriesMemberships: [
              {
                name: "Создание Platform Inside",
                ordinal: 3,
                slug: "platform-inside",
              },
            ],
            slug: "inside-platform-overview",
            summary: "Один реальный published Material.",
            tags: ["Architecture"],
            title: "Как устроен Inside Platform",
            topic: "Platform",
            topicSlug: "platform",
          },
        ],
        kind: "ready",
        reference: { name: "Platform", slug: "platform" },
      });
      const request = vi.mocked(fetch).mock.calls[0]?.[0];
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).url).toBe(
        `https://platform-api.example.test${expectedPath}`,
      );
    },
  );

  it("maps a valid related response and keeps an empty result contextual", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          hasNext: false,
          items: [],
          kind: "related",
          reference: {
            id: "72000000-0000-4000-8000-000000000020",
            name: "Как устроен Inside Platform",
            slug: "inside-platform-overview",
          },
        }),
      ),
    );

    await expect(
      getRelatedMaterials("inside-platform-overview"),
    ).resolves.toEqual({
      discoveryKind: "related",
      kind: "empty",
      reference: {
        name: "Как устроен Inside Platform",
        slug: "inside-platform-overview",
      },
    });
  });

  it("distinguishes missing references and dependency outages", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            type: "urn:inside:problem:discovery-not-found",
            title: "Discovery not found",
            status: 404,
            code: "discovery_not_found",
          },
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            type: "urn:inside:problem:dependency-unavailable",
            title: "Dependency unavailable",
            status: 503,
            code: "dependency_unavailable",
            retryable: true,
          },
          { status: 503 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPublishedTopic("missing")).resolves.toEqual({
      kind: "not-found",
    });
    await expect(getPublishedSeries("platform")).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("rejects a successful response outside the runtime contract", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          hasNext: false,
          items: [{ ...publishedProjection, body: { blocks: [] } }],
          kind: "topic",
          reference: { id: "topic", name: "Platform", slug: "platform" },
        }),
      ),
    );

    await expect(getPublishedTopic("platform")).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});
