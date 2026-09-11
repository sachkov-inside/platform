import { afterEach, describe, expect, it, vi } from "vitest";

import { getPublicSiteIndex } from "@/features/public-site-index.server";

function catalogPage(input: {
  readonly nextCursor: string | null;
  readonly slugs: readonly string[];
}) {
  return Response.json({
    facets: {
      formats: [],
      series: [{ slug: "platform-inside" }, { slug: "ci-cd" }],
      topics: [{ slug: "platform" }],
    },
    items: input.slugs.map((slug) => ({
      publishedAt: "2026-08-25T05:00:00.000Z",
      slug,
      title: "Материал",
    })),
    nextCursor: input.nextCursor,
    totalCount: 3,
  });
}

describe("Указатель опубликованных страниц", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("собирает руководства, темы и все страницы материалов", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(catalogPage({ nextCursor: "cursor-2", slugs: ["first", "second"] }))
      .mockResolvedValueOnce(catalogPage({ nextCursor: null, slugs: ["third"] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPublicSiteIndex()).resolves.toEqual({
      guideSlugs: ["platform-inside", "ci-cd"],
      kind: "ready",
      materials: [
        { publishedAt: "2026-08-25T05:00:00.000Z", slug: "first" },
        { publishedAt: "2026-08-25T05:00:00.000Z", slug: "second" },
        { publishedAt: "2026-08-25T05:00:00.000Z", slug: "third" },
      ],
      topicSlugs: ["platform"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = fetchMock.mock.calls[1]?.[0] as Request | undefined;
    expect(secondRequest).toBeInstanceOf(Request);
    expect(secondRequest?.url).toContain("after=cursor-2");
  });

  it("не запрашивает каталог от имени участника: указатель перечисляет только опубликованное", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(catalogPage({ nextCursor: null, slugs: ["first"] }));
    vi.stubGlobal("fetch", fetchMock);

    await getPublicSiteIndex();

    const request = fetchMock.mock.calls[0]?.[0] as Request | undefined;
    expect(request).toBeInstanceOf(Request);
    expect(request?.headers.has("authorization")).toBe(false);
  });

  it("сообщает о недоступном каталоге вместо ошибки", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "dependency_unavailable",
            retryable: true,
            status: 503,
            title: "Dependency unavailable",
            type: "urn:inside:problem:dependency-unavailable",
          },
          {
            headers: { "content-type": "application/problem+json" },
            status: 503,
          },
        ),
      ),
    );

    await expect(getPublicSiteIndex()).resolves.toEqual({ kind: "unavailable" });
  });
});
