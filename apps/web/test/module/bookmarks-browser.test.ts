import { afterEach, describe, expect, it, vi } from "vitest";

import { getBookmarkStates, listBookmarkPage, setBookmark } from "@/features/bookmarks";
import { bookmarkStatesQueryOptions } from "@/features/bookmarks/api/bookmarks.browser";

const materialId = "10000000-0000-4000-8000-000000000001";
const state = { materialId, bookmarked: true, bookmarkedAt: "2026-09-10T00:00:00.000Z" };

describe("Bookmarks browser contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for bookmark states only with an account", () => {
    expect(bookmarkStatesQueryOptions({ materialId, signedIn: false }).enabled).toBe(false);
    expect(bookmarkStatesQueryOptions({ materialId, signedIn: true }).enabled).toBe(true);
  });

  it("reads the ready states wrapper instead of treating the bookmark as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ kind: "ready", states: [state] })));

    await expect(getBookmarkStates([materialId])).resolves.toEqual({ kind: "ready", states: [state] });
  });

  it("reads the ready state wrapper when saving a bookmark", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ kind: "ready", state })));

    await expect(setBookmark({ materialId, bookmarked: true })).resolves.toEqual({ kind: "ready", state });
  });

  it("preserves denied and malformed save responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(Response.json({ kind: "denied" }))
        .mockResolvedValueOnce(Response.json({ bookmarked: true })),
    );

    await expect(setBookmark({ materialId, bookmarked: true })).resolves.toEqual({ kind: "denied" });
    await expect(setBookmark({ materialId, bookmarked: true })).resolves.toEqual({ kind: "unavailable" });
  });

  it("maps the list page and an unauthorised session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }))
        .mockResolvedValueOnce(new Response(null, { status: 401 })),
    );

    await expect(listBookmarkPage()).resolves.toEqual({ kind: "ready", items: [], nextCursor: null });
    await expect(listBookmarkPage()).resolves.toEqual({ kind: "unauthorized" });
  });
});
