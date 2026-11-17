import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { QueryClient } from "@tanstack/react-query";
import { realBffSession } from "../support/real-bff-session";
import { routeBrowserMutations } from "../support/mutation-operation-route";
import { useProductionRuntimeImage } from "../support/web-runtime";

import { GET } from "../../app/api/library/materials/route";
import { GET as GET_HOME_MATERIALS } from "../../app/api/home/materials/route";
import { GET as GET_TOPIC_MATERIALS } from "../../app/api/library/topics/[topicSlug]/materials/route";
import { handleLibraryCatalogRequest } from "@/features/library-catalog.server";
import { libraryCatalogQueryKey } from "@/features/library-catalog";
import {
  libraryCatalogQueryOptions,
  homeFeedQueryOptions,
  requestLibraryCatalogPage,
  topicLibraryCatalogQueryOptions,
} from "../../src/features/library-catalog/api/library-catalog.browser";
import {
  changeLibraryQuery,
  parseLibrarySearchParams,
  serializeLibrarySearchQuery,
} from "../../src/features/library-catalog/model/library-search-query";

const readyCatalog = {
  facets: { formats: [], products: [], topics: [] },
  kind: "ready",
  items: [
    {
      materialId: "72000000-0000-4000-8000-000000000020",
      publishedAt: "2026-08-25T05:00:00.000Z",
      cover: null,
      difficulty: null,
      outcomes: [],
      formatSlug: "guide",
      access: "free",
      availability: "available",
      format: "Гайд",
      productMemberships: [],
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
  sort: "newest",
  topicSlug: null,
} as const;

const catalogItem = {
  materialId: "72000000-0000-4000-8000-000000000020",
  contentVersion: 3,
  slug: "inside-platform-overview",
  title: "Как устроен Inside Platform",
  summary: "Один реальный published Material.",
  access: "free",
  availability: "available",
  difficulty: null,
  outcomes: [],
  cover: null,
  publishedAt: "2026-08-25T05:00:00.000Z",
  primaryVideoId: null,
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
  tags: [{ id: "72000000-0000-4000-8000-000000000004", name: "Architecture" }],
  productMemberships: [],
} as const;
const backendCatalog = {
  facets: { formats: [], products: [], topics: [] },
  items: [catalogItem],
  nextCursor: null,
  totalCount: 1,
} as const;
let scope: Awaited<ReturnType<typeof realBffSession>>;
let cleanupImage: () => void;
let backendRequests: Request[];
let unexpectedRequests: string[];
let clients: QueryClient[];

function queryClient() {
  const client = new QueryClient();
  clients.push(client);
  return client;
}

function connectCatalog(respond: (request: Request) => Promise<Response>) {
  return routeBrowserMutations(
    {
      "/api/library/materials": { GET },
      "/api/home/materials": { GET: GET_HOME_MATERIALS },
      "/api/library/topics/platform/materials": {
        GET: (request) =>
          GET_TOPIC_MATERIALS(request, {
            params: Promise.resolve({ topicSlug: "platform" }),
          }),
      },
    },
    "https://inside.example.test",
    {
      run: (handler) => scope(handler),
      externalFetch: (request) => {
        backendRequests.push(request.clone());
        const url = new URL(request.url);
        if (
          request.method !== "GET" ||
          url.origin !== "https://platform-api.example.test" ||
          url.pathname !== "/library/materials"
        ) {
          unexpectedRequests.push(`${request.method} ${request.url}`);
          return Promise.reject(
            new Error("Unexpected external catalog request"),
          );
        }
        return respond(request);
      },
    },
  );
}

function browserCalls(fetch: ReturnType<typeof connectCatalog>["fetch"]) {
  return fetch.mock.calls.filter(
    ([input]) => typeof input === "string" && input.startsWith("/api/"),
  );
}

describe("Library TanStack Query interface", () => {
  beforeEach(async () => {
    cleanupImage = useProductionRuntimeImage();
    scope = await realBffSession(null);
    backendRequests = [];
    unexpectedRequests = [];
    clients = [];
  });
  afterEach(() => {
    for (const client of clients) client.clear();
    cleanupImage();
    expect(unexpectedRequests).toEqual([]);
    for (const request of backendRequests) {
      expect(request.method).toBe("GET");
      expect(new URL(request.url).origin).toBe(
        "https://platform-api.example.test",
      );
      expect(new URL(request.url).pathname).toBe("/library/materials");
      expect(request.headers.get("authorization")).toBeNull();
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps home feed pages out of the full catalog cache", async () => {
    const { fetch: fetchMock } = connectCatalog(
      vi.fn().mockResolvedValue(Response.json(backendCatalog)),
    );
    const client = queryClient();
    const feed = homeFeedQueryOptions(defaultQuery);
    expect(feed.queryKey).not.toEqual(libraryCatalogQueryKey(defaultQuery));
    await client.infiniteQuery(feed);
    expect(browserCalls(fetchMock)[0]?.[0]).toBe("/api/home/materials");
    expect(
      client.getQueryData(libraryCatalogQueryKey(defaultQuery)),
    ).toBeUndefined();
  });

  it("searches the full catalog from home and preserves locked paid results", async () => {
    const paid = {
      ...catalogItem,
      access: "closed",
      availability: "locked",
      slug: "developer-pipeline",
      title: "Developer Pipeline",
    };
    const { fetch: fetchMock } = connectCatalog(
      vi
        .fn()
        .mockResolvedValue(Response.json({ ...backendCatalog, items: [paid] })),
    );
    const client = queryClient();
    const query = { ...defaultQuery, q: "Developer Pipeline" };
    const page = await client.infiniteQuery(homeFeedQueryOptions(query));
    expect(browserCalls(fetchMock)[0]?.[0]).toBe(
      "/api/library/materials?q=Developer+Pipeline&sort=newest",
    );
    expect(page.pages[0]).toMatchObject({
      kind: "ready",
      items: [
        {
          access: "closed",
          availability: "locked",
          slug: "developer-pipeline",
        },
      ],
    });
  });

  it("binds the home BFF to feed scope and rejects a client override", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          facets: { formats: [], products: [], topics: [] },
          items: [],
          nextCursor: null,
          totalCount: 0,
        }),
      ),
    );
    const refused = await GET_HOME_MATERIALS(
      new Request(
        "https://platform-web.example.test/api/home/materials?feedOnly=false",
      ),
    );
    expect(refused.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    const response = await GET_HOME_MATERIALS(
      new Request("https://platform-web.example.test/api/home/materials"),
    );
    expect(response.status).toBe(200);
    const request = vi.mocked(fetch).mock.calls[0]?.[0];
    if (!(request instanceof Request))
      throw new Error("Missing backend request");
    expect(new URL(request.url).searchParams.get("feedOnly")).toBe("true");
  });

  it("keeps global search and material-only filters in the canonical URL", () => {
    const parsed = parseLibrarySearchParams({
      after: ["cursor-one", "cursor-two"],
      format: ["video", "INVALID", "video"],
      ignored: "value",
      q: "  карьерный   маршрут  ",
      product: ["career-path", ""],
      sort: "unknown",
      topic: ["platform", "career", "platform"],
    });

    expect(parsed.query).toEqual({
      after: "cursor-one",
      formatSlugs: ["video"],
      q: "карьерный маршрут",
      sort: "relevance",
      topicSlug: "platform",
    });
    expect(parsed.wasNormalized).toBe(true);
    expect(serializeLibrarySearchQuery(parsed.query)).toBe(
      "q=%D0%BA%D0%B0%D1%80%D1%8C%D0%B5%D1%80%D0%BD%D1%8B%D0%B9+%D0%BC%D0%B0%D1%80%D1%88%D1%80%D1%83%D1%82&topic=platform&format=video",
    );
  });

  it("normalizes one safe Topic filter and resets the cursor when it changes", () => {
    const initial = parseLibrarySearchParams({
      after: "cursor-one",
      q: "platform",
      topic: ["product-engineering", "career"],
    }).query;

    expect(initial).toMatchObject({
      after: "cursor-one",
      q: "platform",
      topicSlug: "product-engineering",
    });
    expect(changeLibraryQuery(initial, { topicSlug: "career" })).toMatchObject({
      after: null,
      q: "platform",
      topicSlug: "career",
    });
    expect(
      serializeLibrarySearchQuery({ ...initial, topicSlug: "INVALID topic" }),
    ).toBe("q=platform");
  });

  it("uses newest by default and relevance while searching", () => {
    const initial = parseLibrarySearchParams({});
    const searched = parseLibrarySearchParams({ q: "platform" });

    expect(initial.query.sort).toBe("newest");
    expect(serializeLibrarySearchQuery(initial.query)).toBe("");
    expect(searched.query.sort).toBe("relevance");
    expect(serializeLibrarySearchQuery(searched.query)).toBe("q=platform");
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
    ).toEqual(libraryCatalogQueryKey(defaultQuery));
  });

  it("stores cursor continuations as pages of one infinite query", async () => {
    const { fetch: fetchMock } = connectCatalog(
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ...backendCatalog, nextCursor: "next_cursor" }),
        )
        .mockResolvedValueOnce(Response.json(backendCatalog)),
    );
    const catalogClient = queryClient();

    const data = await catalogClient.infiniteQuery({
      ...libraryCatalogQueryOptions(defaultQuery),
      pages: 2,
    });

    expect(data.pageParams).toEqual([undefined, "next_cursor"]);
    expect(data.pages).toHaveLength(2);
    expect(browserCalls(fetchMock)[0]?.[0]).toBe("/api/library/materials");
    expect(browserCalls(fetchMock)[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(browserCalls(fetchMock)[1]?.[0]).toBe(
      "/api/library/materials?after=next_cursor",
    );
    expect(browserCalls(fetchMock)[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(
      catalogClient.getQueryData(libraryCatalogQueryKey(defaultQuery)),
    ).toEqual(data);
  });

  it("keeps the Topic scope while loading results beyond the first page", async () => {
    const { fetch: fetchMock } = connectCatalog(
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ...backendCatalog, nextCursor: "topic_next_cursor" }),
        )
        .mockResolvedValueOnce(
          Response.json({
            ...backendCatalog,
            items: [
              {
                ...catalogItem,
                slug: "topic-second-page",
                title: "Материал со второй страницы темы",
              },
            ],
          }),
        ),
    );
    const topicQuery = defaultQuery;
    const data = await queryClient().infiniteQuery({
      ...topicLibraryCatalogQueryOptions("platform", topicQuery),
      pages: 2,
    });

    const secondPage = data.pages[1];
    expect(secondPage).toMatchObject({
      kind: "ready",
      items: [expect.objectContaining({ slug: "topic-second-page" })],
    });
    expect(browserCalls(fetchMock)[0]?.[0]).toBe(
      "/api/library/topics/platform/materials",
    );
    expect(browserCalls(fetchMock)[1]?.[0]).toBe(
      "/api/library/topics/platform/materials?after=topic_next_cursor",
    );
  });

  it("uses canonical Topic scope without exposing archived Topics as discovery filters", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          facets: { formats: [], products: [], topics: [] },
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
    const backendRequest = z
      .instanceof(Request)
      .parse(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(backendRequest.url).toBe(
      "https://platform-api.example.test/library/materials?sort=newest&canonicalTopic=platform",
    );
  });

  it("loads and validates the browser presentation contract", async () => {
    const signal = AbortSignal.timeout(1_000);
    const { fetch: fetchMock } = connectCatalog(
      vi.fn().mockResolvedValue(Response.json(backendCatalog)),
    );

    await expect(
      requestLibraryCatalogPage(defaultQuery, "next_cursor", signal),
    ).resolves.toEqual(readyCatalog);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/library/materials?after=next_cursor",
      {
        headers: { Accept: "application/json" },
        signal,
      },
    );
  });

  it("rejects a browser response outside the presentation contract under named wire corruption", async () => {
    const bridge = connectCatalog(
      vi.fn().mockResolvedValue(Response.json(backendCatalog)),
    );
    const receipts: { status: number; bodyUsed: boolean }[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(
          input instanceof Request
            ? input
            : new URL(input, "https://inside.example.test"),
          init,
        );
        // deterministic-test-allow unit-io: #2292, audit2 worker 7e1496b5; the in-process bridge invokes the real handler before this exact named wire fault.
        const response = await bridge.fetch(input, init);
        if (new URL(request.url).origin !== "https://inside.example.test")
          return response;
        expect(request.method).toBe("GET");
        expect(request.url).toBe(
          "https://inside.example.test/api/library/materials",
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(readyCatalog);
        receipts.push({ status: response.status, bodyUsed: response.bodyUsed });
        return Response.json(
          { ...readyCatalog, items: [{ title: "Incomplete" }] },
          { status: response.status, headers: response.headers },
        );
      },
    );
    await expect(
      requestLibraryCatalogPage(
        defaultQuery,
        undefined,
        AbortSignal.timeout(1_000),
      ),
    ).rejects.toMatchObject({
      name: "LibraryCatalogQueryError",
      message:
        "Library query response does not match the presentation contract",
    });
    expect(receipts).toEqual([{ status: 200, bodyUsed: true }]);
    expect(backendRequests).toHaveLength(1);
  });

  it("keeps the real handler rejection of malformed backend data separate from wire corruption", async () => {
    connectCatalog(
      vi.fn().mockResolvedValue(
        Response.json({
          ...backendCatalog,
          items: [{ title: "Incomplete" }],
        }),
      ),
    );
    await expect(
      scope(() =>
        GET(new Request("https://inside.example.test/api/library/materials")),
      ),
    ).rejects.toMatchObject({
      code: "invalid-response",
    });
    expect(backendRequests).toHaveLength(1);
  });

  it("keeps the NestJS address behind the same-origin BFF route", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          facets: { formats: [], products: [], topics: [] },
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
      facets: { formats: [], products: [], topics: [] },
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
      "https://platform-api.example.test/library/materials?sort=newest&after=next_cursor",
    );
    expect(backendRequest.cache).toBe("no-store");
  });

  it("forwards the canonical material Topic filter without changing the Product contract", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          facets: { formats: [], products: [], topics: [] },
          items: [],
          nextCursor: null,
          totalCount: 0,
        }),
      ),
    );

    const response = await GET(
      new Request(
        "https://platform-web.example.test/api/library/materials?q=platform&topic=product-engineering&format=video&sort=title",
      ),
    );

    expect(response.status).toBe(200);
    const backendRequest = z
      .instanceof(Request)
      .parse(vi.mocked(fetch).mock.calls[0]?.[0]);
    const backendUrl = new URL(backendRequest.url);
    expect(backendUrl.searchParams.get("q")).toBe("platform");
    expect(backendUrl.searchParams.getAll("topic")).toEqual([
      "product-engineering",
    ]);
    expect(backendUrl.searchParams.getAll("format")).toEqual(["video"]);
    expect(backendUrl.searchParams.get("sort")).toBe("title");
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
            type: "urn:inside:problem:invalid_request_shape",
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
          facets: { formats: [], products: [], topics: [] },
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
