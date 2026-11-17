import { beforeEach, expect, it, vi } from "vitest";
import { getPublicSitemapResponse } from "@/features/public-site-index.server";
import { configureWebRuntime } from "../support/web-runtime";
import { interceptBackendHttp } from "../support/backend-http";

const backend = vi.fn<(request: Request) => Promise<Response>>();
beforeEach(() => {
  backend.mockReset();
  configureWebRuntime();
  interceptBackendHttp(backend);
});

it("renders the requested complete sitemap chunk with escaped URLs and publication dates", async () => {
  vi.stubEnv("WEB_BASE_URL", "https://a&b.example.test");
  backend
    .mockResolvedValueOnce(
      Response.json({
        productSlugs: [],
        topicSlugs: [],
        items: Array.from({ length: 50_000 }, (_, index) => ({
          slug: `material-${index}`,
          publishedAt: "2026-09-01T00:00:00.000Z",
        })),
        nextCursor: "page-2",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        productSlugs: [],
        topicSlugs: [],
        items: [{ slug: "last", publishedAt: "2026-10-01T00:00:00.000Z" }],
        nextCursor: null,
      }),
    );
  const response = await getPublicSitemapResponse("1.xml");
  expect(response.status).toBe(200);
  const xml = await response.text();
  expect(xml).toContain(
    "<url><loc>https://a&amp;b.example.test/materials/last</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod></url>",
  );
  expect(xml).not.toContain("/materials/material-0</loc>");
  expect(response.headers.get("content-type")).toBe("application/xml");
  expect(backend).toHaveBeenCalledTimes(2);
  const requests = backend.mock.calls.map(([request]) => request);
  expect(requests.map((request) => request.url)).toEqual([
    "https://platform-api.example.test/library/site-index",
    "https://platform-api.example.test/library/site-index?after=page-2",
  ]);
  for (const request of requests) {
    expect(request.method).toBe("GET");
    expect(request.headers.get("authorization")).toBeNull();
  }
});

it.each(["-1.xml", "1", "01.xml", "9007199254740992.xml", "missing.xml"])(
  "rejects malformed chunk %s",
  async (id) => {
    expect((await getPublicSitemapResponse(id)).status).toBe(404);
    expect(backend).not.toHaveBeenCalled();
  },
);

it("returns 404 for a chunk outside the complete index", async () => {
  backend.mockResolvedValueOnce(
    Response.json({
      productSlugs: [],
      topicSlugs: [],
      items: [],
      nextCursor: null,
    }),
  );
  expect((await getPublicSitemapResponse("1.xml")).status).toBe(404);
  expect(backend).toHaveBeenCalledOnce();
});
