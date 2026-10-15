import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  getPublicSiteIndex,
  partitionPublicSitemap,
} from "@/features/public-site-index.server";

function siteIndexPage(input: {
  readonly nextCursor: string | null;
  readonly slugs: readonly string[];
}) {
  return Response.json({
    productSlugs: ["platform-inside", "ci-cd"],
    topicSlugs: ["platform"],
    items: input.slugs.map((slug) => ({
      publishedAt: "2026-08-25T05:00:00.000Z",
      slug,
    })),
    nextCursor: input.nextCursor,
  });
}

describe("Указатель опубликованных страниц", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("собирает продукты, темы и все страницы материалов", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        siteIndexPage({ nextCursor: "cursor-2", slugs: ["first", "second"] }),
      )
      .mockResolvedValueOnce(
        siteIndexPage({ nextCursor: null, slugs: ["third"] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPublicSiteIndex()).resolves.toEqual({
      productSlugs: ["platform-inside", "ci-cd"],
      kind: "ready",
      materials: [
        { publishedAt: "2026-08-25T05:00:00.000Z", slug: "first" },
        { publishedAt: "2026-08-25T05:00:00.000Z", slug: "second" },
        { publishedAt: "2026-08-25T05:00:00.000Z", slug: "third" },
      ],
      topicSlugs: ["platform"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = z
      .instanceof(Request)
      .parse(fetchMock.mock.calls[1]?.[0]);
    expect(secondRequest.url).toContain("after=cursor-2");
    expect(secondRequest.url).toContain("/library/site-index");
  });

  it("reaches Material 1201 beyond the former hundred-page limit", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    let page = 0;
    const fetchMock = vi.fn(() => {
      const offset = page++ * 12;
      const count = Math.min(12, 1201 - offset);
      return Promise.resolve(
        siteIndexPage({
          nextCursor: offset + count === 1201 ? null : `cursor-${String(page)}`,
          slugs: Array.from(
            { length: count },
            (_, index) => `material-${String(offset + index + 1)}`,
          ),
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await getPublicSiteIndex();
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Expected complete index");
    expect(result.materials).toHaveLength(1201);
    expect(result.materials.at(-1)?.slug).toBe("material-1201");
    expect(fetchMock).toHaveBeenCalledTimes(101);
  });

  it("rejects a repeated continuation instead of reporting partial success", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          siteIndexPage({ nextCursor: "cycle", slugs: ["first"] }),
        ),
      ),
    );
    await expect(getPublicSiteIndex()).rejects.toThrow("continuation");
  });

  it("splits all emitted URL kinds without dropping overflow", () => {
    const entries = [
      "/",
      "/products/product",
      "/topics/topic",
      ...Array.from(
        { length: 50_000 },
        (_, index) => `/materials/${String(index)}`,
      ),
    ];
    const chunks = partitionPublicSitemap(entries);
    expect(chunks.map((chunk) => chunk.length)).toEqual([50_000, 3]);
    expect(chunks.flat()).toEqual(entries);
  });

  it("не запрашивает каталог от имени участника: указатель перечисляет только опубликованное", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(siteIndexPage({ nextCursor: null, slugs: ["first"] }));
    vi.stubGlobal("fetch", fetchMock);

    await getPublicSiteIndex();

    const request = z.instanceof(Request).parse(fetchMock.mock.calls[0]?.[0]);
    expect(request.headers.has("authorization")).toBe(false);
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
            type: "urn:inside:problem:dependency_unavailable",
          },
          {
            headers: { "content-type": "application/problem+json" },
            status: 503,
          },
        ),
      ),
    );

    await expect(getPublicSiteIndex()).resolves.toEqual({
      kind: "unavailable",
    });
  });
});
