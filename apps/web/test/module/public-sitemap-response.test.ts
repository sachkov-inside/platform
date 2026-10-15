import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ chunks: vi.fn() }));
vi.mock("@/features/public-site-index/api/get-public-sitemap-chunks", () => ({
  getPublicSitemapChunks: fakes.chunks,
}));
import { getPublicSitemapResponse } from "@/features/public-site-index.server";

beforeEach(() => {
  fakes.chunks.mockReset();
});

it("renders the requested complete sitemap chunk with escaped URLs and publication dates", async () => {
  fakes.chunks.mockResolvedValue([
    [{ url: "https://example.test/" }],
    [
      {
        url: "https://example.test/materials/last?a=1&b=2",
        lastModified: "2026-10-01T00:00:00.000Z",
      },
    ],
  ]);
  const response = await getPublicSitemapResponse("1.xml");
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(
    "<url><loc>https://example.test/materials/last?a=1&amp;b=2</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod></url>",
  );
  expect(response.headers.get("content-type")).toBe("application/xml");
});

it.each(["-1.xml", "1", "01.xml", "9007199254740992.xml", "missing.xml"])(
  "rejects malformed chunk %s",
  async (id) => {
    expect((await getPublicSitemapResponse(id)).status).toBe(404);
    expect(fakes.chunks).not.toHaveBeenCalled();
  },
);

it("returns 404 for a chunk outside the complete index", async () => {
  fakes.chunks.mockResolvedValue([[{ url: "https://example.test/" }]]);
  expect((await getPublicSitemapResponse("1.xml")).status).toBe(404);
});
