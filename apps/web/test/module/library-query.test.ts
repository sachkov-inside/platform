import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { GET } from "../../app/api/library/materials/route";
import { libraryCatalogQueryKey } from "@/_pages/library";
import { getQueryClient } from "@/shared/api/query-client";
import { requestLibraryCatalogPage } from "../../src/_pages/library/api/request-library-catalog";
import { libraryCatalogBrowserQueryOptions } from "../../src/_pages/library/api/library-catalog-query.browser";

const readyCatalog = {
  kind: "ready",
  items: [
    {
      access: "free",
      format: "Гайд",
      seriesMemberships: [],
      slug: "inside-platform-overview",
      summary: "Один реальный published Material.",
      tags: ["Architecture"],
      title: "Как устроен Inside Platform",
      topic: "Platform",
    },
  ],
  nextCursor: null,
} as const;

describe("Library TanStack Query interface", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses one deterministic query key for every cursor page", () => {
    expect(libraryCatalogQueryKey).toEqual(["library", "catalog"]);
  });

  it("isolates QueryClient caches between server requests", () => {
    expect(getQueryClient()).not.toBe(getQueryClient());
  });

  it("stores cursor continuations as pages of one infinite query", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...readyCatalog, nextCursor: "next/cursor" }),
      )
      .mockResolvedValueOnce(Response.json(readyCatalog));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient();

    const data = await queryClient.infiniteQuery({
      ...libraryCatalogBrowserQueryOptions(),
      pages: 2,
    });

    expect(data.pageParams).toEqual([undefined, "next/cursor"]);
    expect(data.pages).toHaveLength(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/library/materials");
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/library/materials?after=next%2Fcursor",
    );
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(queryClient.getQueryData(libraryCatalogQueryKey)).toEqual(data);
  });

  it("loads and validates the browser presentation contract", async () => {
    const signal = AbortSignal.timeout(1_000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(readyCatalog)),
    );

    await expect(
      requestLibraryCatalogPage("next/cursor", signal),
    ).resolves.toEqual(readyCatalog);
    expect(fetch).toHaveBeenCalledWith(
      "/api/library/materials?after=next%2Fcursor",
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
      requestLibraryCatalogPage(undefined, AbortSignal.timeout(1_000)),
    ).rejects.toMatchObject({
      name: "LibraryCatalogQueryError",
      message: "Library query response does not match the presentation contract",
    });
  });

  it("keeps the NestJS address behind the same-origin BFF route", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null })),
    );

    const response = await GET(
      new Request(
        "https://platform-web.example.test/api/library/materials?after=next%2Fcursor",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=30, stale-while-revalidate=60",
    );
    await expect(response.json()).resolves.toEqual({
      kind: "ready",
      items: [],
      nextCursor: null,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://platform-api.example.test/library/materials?after=next%2Fcursor",
      expect.objectContaining({ cache: "no-store" }),
    );
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
});
