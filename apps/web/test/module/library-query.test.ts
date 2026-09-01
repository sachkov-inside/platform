import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { GET } from "../../app/api/library/materials/route";
import { GET as GET_TOPIC_MATERIALS } from "../../app/api/library/topics/[topicSlug]/materials/route";
import { handleLibraryCatalogRequest } from "@/_pages/library.server";
import { libraryCatalogQueryKey } from "@/_pages/library";
import {
  libraryCatalogQueryOptions,
  requestLibraryCatalogPage,
  topicLibraryCatalogQueryOptions,
} from "../../src/features/library-catalog/api/library-catalog.browser";
import {
  parseLibrarySearchParams,
  serializeLibrarySearchQuery,
} from "../../src/features/library-catalog/model/library-search-query";

const readyCatalog = {
  facets: { formats: [], series: [], topics: [] },
  kind: "ready",
  items: [
    {
      access: "free",
      availability: "available",
      format: "Гайд",
      seriesMemberships: [],
      slug: "inside-platform-overview",
      summary: "Один реальный published Material.",
      tags: ["Architecture"],
      title: "Как устроен Inside Platform",
      topic: "Platform",
      topicSlug: "platform",
    },
  ],
  nextCursor: null,
  totalCount: 1,
} as const;
const defaultQuery = {
  after: null,
  formatSlugs: [],
  q: "",
  seriesSlugs: [],
  sort: "relevance",
  topicSlugs: [],
} as const;

describe("Library TanStack Query interface", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("normalizes shareable search, facets, sort and cursor into one canonical URL", () => {
    const parsed = parseLibrarySearchParams({
      after: ["cursor-one", "cursor-two"],
      format: ["video", "INVALID", "video"],
      ignored: "value",
      q: "  карьерный   маршрут  ",
      series: ["career-path", ""],
      sort: "unknown",
      topic: ["platform", "career", "platform"],
    });

    expect(parsed.query).toEqual({
      after: "cursor-one",
      formatSlugs: ["video"],
      q: "карьерный маршрут",
      seriesSlugs: ["career-path"],
      sort: "relevance",
      topicSlugs: ["career", "platform"],
    });
    expect(parsed.wasNormalized).toBe(true);
    expect(serializeLibrarySearchQuery(parsed.query)).toBe(
      "q=%D0%BA%D0%B0%D1%80%D1%8C%D0%B5%D1%80%D0%BD%D1%8B%D0%B9+%D0%BC%D0%B0%D1%80%D1%88%D1%80%D1%83%D1%82&topic=career&topic=platform&format=video&series=career-path&after=cursor-one",
    );
  });

  it("uses author-defined order as the canonical default for one Series", () => {
    const parsed = parseLibrarySearchParams({ series: "platform-inside" });

    expect(parsed.query.sort).toBe("series");
    expect(serializeLibrarySearchQuery(parsed.query)).toBe(
      "series=platform-inside",
    );
    expect(parsed.wasNormalized).toBe(false);
  });

  it("truncates long Unicode queries without sending a broken surrogate to NestJS", () => {
    const parsed = parseLibrarySearchParams({
      q: `${"a".repeat(119)}💡ignored`,
    });

    expect(parsed.query.q).toBe("a".repeat(119));
    expect(parsed.query.q.length).toBeLessThanOrEqual(120);
    expect(parsed.wasNormalized).toBe(true);
  });

  it("uses one deterministic query key for every cursor page", () => {
    expect(libraryCatalogQueryKey(defaultQuery)).toEqual([
      "library",
      "catalog",
      "",
    ]);
    expect(
      libraryCatalogQueryKey({ ...defaultQuery, after: "next_cursor" }),
    ).toEqual(
      libraryCatalogQueryKey(defaultQuery),
    );
  });

  it("stores cursor continuations as pages of one infinite query", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...readyCatalog, nextCursor: "next_cursor" }),
      )
      .mockResolvedValueOnce(Response.json(readyCatalog));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient();

    const data = await queryClient.infiniteQuery({
      ...libraryCatalogQueryOptions(defaultQuery),
      pages: 2,
    });

    expect(data.pageParams).toEqual([undefined, "next_cursor"]);
    expect(data.pages).toHaveLength(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/library/materials");
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/library/materials?after=next_cursor",
    );
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(
      queryClient.getQueryData(libraryCatalogQueryKey(defaultQuery)),
    ).toEqual(data);
  });

  it("keeps the Topic scope while loading results beyond the first page", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...readyCatalog, nextCursor: "topic_next_cursor" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...readyCatalog,
          items: [
            {
              ...readyCatalog.items[0],
              slug: "topic-second-page",
              title: "Материал со второй страницы темы",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const topicQuery = { ...defaultQuery, topicSlugs: ["platform"] };
    const data = await new QueryClient().infiniteQuery({
      ...topicLibraryCatalogQueryOptions("platform", topicQuery),
      pages: 2,
    });

    const secondPage = data.pages[1];
    expect(secondPage).toMatchObject({
      kind: "ready",
      items: [expect.objectContaining({ slug: "topic-second-page" })],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/library/topics/platform/materials",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/library/topics/platform/materials?after=topic_next_cursor",
    );
  });

  it("uses canonical Topic scope without exposing archived Topics as discovery filters", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          facets: { formats: [], series: [], topics: [] },
          items: [],
          nextCursor: null,
          totalCount: 0,
        }),
      ),
    );

    const response = await GET_TOPIC_MATERIALS(
      new Request(
        "https://platform-web.example.test/api/library/topics/platform/materials",
      ),
      { params: Promise.resolve({ topicSlug: "platform" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ kind: "empty" });
    const backendRequest = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(backendRequest).toBeInstanceOf(Request);
    expect((backendRequest as Request).url).toBe(
      "https://platform-api.example.test/library/materials?sort=relevance&canonicalTopic=platform",
    );
  });

  it("loads and validates the browser presentation contract", async () => {
    const signal = AbortSignal.timeout(1_000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(readyCatalog)),
    );

    await expect(
      requestLibraryCatalogPage(defaultQuery, "next_cursor", signal),
    ).resolves.toEqual(readyCatalog);
    expect(fetch).toHaveBeenCalledWith(
      "/api/library/materials?after=next_cursor",
      {
        headers: { Accept: "application/json" },
        signal,
      },
    );
  });

  it("rejects a browser response outside the presentation contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ ...readyCatalog, items: [{ title: "Incomplete" }] }),
      ),
    );

    await expect(
      requestLibraryCatalogPage(
        defaultQuery,
        undefined,
        AbortSignal.timeout(1_000),
      ),
    ).rejects.toMatchObject({
      name: "LibraryCatalogQueryError",
      message: "Library query response does not match the presentation contract",
    });
  });

  it("keeps the NestJS address behind the same-origin BFF route", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          facets: { formats: [], series: [], topics: [] },
          items: [],
          nextCursor: null,
          totalCount: 0,
        }),
      ),
    );

    const response = await GET(
      new Request(
        "https://platform-web.example.test/api/library/materials?after=next_cursor",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=30, stale-while-revalidate=60",
    );
    await expect(response.json()).resolves.toEqual({
      kind: "ready",
      facets: { formats: [], series: [], topics: [] },
      items: [],
      nextCursor: null,
      totalCount: 0,
    });
    const backendRequest = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(backendRequest).toBeInstanceOf(Request);
    if (!(backendRequest instanceof Request)) {
      throw new TypeError("BFF did not use the generated server transport");
    }
    expect(backendRequest.url).toBe(
      "https://platform-api.example.test/library/materials?sort=relevance&after=next_cursor",
    );
    expect(backendRequest.cache).toBe("no-store");
  });

  it("rejects ambiguous BFF cursors before calling NestJS", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "https://platform-web.example.test/api/library/materials?after=one&after=two",
      ),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a controlled 400 when NestJS rejects an opaque cursor", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            type: "urn:inside:problem:invalid-request-shape",
            title: "Invalid request shape",
            status: 400,
            code: "invalid_request_shape",
          },
          {
            status: 400,
            headers: { "Content-Type": "application/problem+json" },
          },
        ),
      ),
    );

    const response = await GET(
      new Request(
        "https://platform-web.example.test/api/library/materials?after=opaque_cursor",
      ),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("forwards an authenticated viewer and prevents shared BFF caching", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi.fn((request: Request) => {
      expect(request.headers.get("authorization")).toBe(
        "Bearer platform-access-token",
      );
      return Promise.resolve(
        Response.json({
          facets: { formats: [], series: [], topics: [] },
          items: [],
          nextCursor: null,
          totalCount: 0,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleLibraryCatalogRequest(
      new Request("https://platform-web.example.test/api/library/materials"),
      "platform-access-token",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
