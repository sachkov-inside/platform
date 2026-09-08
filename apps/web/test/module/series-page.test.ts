import { describe, expect, it } from "vitest";
import { seriesPage } from "@/_pages/library-discovery/model/series-page";
import { internalRoute } from "@/shared/routing/internal-route";
import { materialReaderHref, parseMaterialReaderReturnTarget, seriesReaderReturnHref } from "@/shared/routing/material-reader";

describe("Series pagination and return context", () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1);
  it("preserves global positions and clamps stale pages after composition changes", () => {
    expect(seriesPage(items, 2)).toMatchObject({ number: 2, count: 3, offset: 12, items: items.slice(12, 24) });
    expect(seriesPage(items, 99)).toMatchObject({ number: 3, offset: 24, items: [25] });
    expect(seriesPage([], 99)).toMatchObject({ number: 1, count: 1, items: [] });
  });
  it("keeps long pagination bounded", () => {
    expect(seriesPage(Array.from({ length: 1200 }), 50).pages).toEqual([1, null, 49, 50, 51, null, 100]);
  });
  it("keeps the continuation page visible outside the current page window", () => {
    expect(seriesPage(Array.from({ length: 120 }), 1, 5).pages).toEqual([1, 2, null, 5, null, 10]);
    expect(seriesPage(items, 1, 99).pages).toEqual([1, 2, 3]);
  });
  it("retains page, material and navigation origin through a Reader link", () => {
    const href = seriesReaderReturnHref(internalRoute("/series/platform?from=%2F"), 2, "ci");
    expect(parseMaterialReaderReturnTarget(href)).toMatchObject({ kind: "series", seriesSlug: "platform", href });
    expect(materialReaderHref("ci", href)).toContain("page%3D2%26at%3Dci");
    expect(seriesReaderReturnHref(href, 1)).toBe("/series/platform?from=%2F&page=1");
  });
  it.each(["page=0", "page=-1", "page=2&page=3", "page=1e2", "at=bad%22slug", "from=https://evil.example", "other=2"])("rejects invalid Series return context: %s", (query) => {
    expect(parseMaterialReaderReturnTarget(`/series/platform?${query}`).kind).toBe("library");
  });
});
