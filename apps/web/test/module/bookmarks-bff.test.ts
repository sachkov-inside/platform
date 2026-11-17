import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";

const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleBookmarkList as realHandleBookmarkList,
  handleBookmarkStates as realHandleBookmarkStates,
  handleSetBookmark as realHandleSetBookmark,
} from "@/features/bookmarks.server";

const handleBookmarkList = (request: Request) =>
  session(() => realHandleBookmarkList(request));
const handleBookmarkStates = (request: Request) =>
  session(() => realHandleBookmarkStates(request));
const handleSetBookmark = (request: Request) =>
  session(() => realHandleSetBookmark(request));

const materialId = "10000000-0000-4000-8000-000000000001";
const state = {
  materialId,
  bookmarked: true,
  bookmarkedAt: "2026-09-07T00:00:00.000Z",
};
const projection = {
  access: "free",
  availability: "available",
  contentVersion: 1,
  cover: null,
  format: { id: "note", name: "Заметка", slug: "note" },
  materialId,
  primaryVideoId: null,
  publishedAt: "2026-09-07T00:00:00.000Z",
  productMemberships: [],
  slug: "bookmark-me",
  summary: "Материал для проверки закладок.",
  tags: [],
  title: "Закладка",
  topic: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Bookmarks",
    slug: "bookmarks",
  },
};

function mutation(
  values: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  return new Request("https://inside.example.test/api/bookmarks/state", {
    method: "PUT",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(values),
  });
}

beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  session = await realBffSession();
  vi.stubGlobal("fetch", backend);
});

afterEach(() => vi.useRealTimers());

it("rejects cross-origin writes before authentication or backend calls", async () => {
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
  session = await realBffSession(null);
  const response = await handleSetBookmark(
    mutation({ materialId, bookmarked: true }, "https://outside.test"),
  );
  expect(response.status).toBe(403);
  expect(tokenReads).not.toHaveBeenCalled();
  expect(backend).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("no-store, private");
});

it("routes the desired bookmark state to add or remove without trusting posted identity", async () => {
  backend
    .mockResolvedValueOnce(Response.json(state))
    .mockResolvedValueOnce(
      Response.json({ materialId, bookmarked: false, bookmarkedAt: null }),
    );
  const added = await handleSetBookmark(
    mutation({ materialId, bookmarked: true, accountId: "untrusted" }),
  );
  expect(
    expectBackendRequest(0, "PUT", `/bookmarks/materials/${materialId}`).body,
  ).toBeNull();
  expect(await added.json()).toEqual({ kind: "ready", state });
  const removed = await handleSetBookmark(
    mutation({ materialId, bookmarked: false, accountId: "untrusted" }),
  );
  expect(
    expectBackendRequest(1, "DELETE", `/bookmarks/materials/${materialId}`)
      .body,
  ).toBeNull();
  expect(await removed.json()).toEqual({
    kind: "ready",
    state: { materialId, bookmarked: false, bookmarkedAt: null },
  });
});

it("reports denied and unavailable without claiming a saved bookmark", async () => {
  backend.mockResolvedValueOnce(
    Response.json({ code: "access_denied" }, { status: 403 }),
  );
  expect(
    await (
      await handleSetBookmark(mutation({ materialId, bookmarked: true }))
    ).json(),
  ).toEqual({ kind: "denied" });
  backend
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce(Response.json({ bookmarked: true }));
  for (let index = 0; index < 2; index += 1) {
    expect(
      await (
        await handleSetBookmark(mutation({ materialId, bookmarked: true }))
      ).json(),
    ).toEqual({ kind: "unavailable" });
  }
});

it("bounds and validates bookmark state batches", async () => {
  backend.mockResolvedValueOnce(Response.json([state]));
  const response = await handleBookmarkStates(
    mutation({ materialIds: [materialId] }),
  );
  expect(await response.json()).toEqual({ kind: "ready", states: [state] });
  const sent = expectBackendRequest(0, "POST", "/bookmarks/materials/query");
  expect(await sent.json()).toEqual({ materialIds: [materialId] });
  const body = JSON.stringify({
    materialIds: Array.from({ length: 101 }, () => materialId),
  });
  expect(
    await (
      await handleBookmarkStates(
        new Request("https://inside.example.test/api/bookmarks/states", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://inside.example.test",
          },
          body,
        }),
      )
    ).json(),
  ).toEqual({ kind: "invalid_input" });
  expect(backend).toHaveBeenCalledTimes(1);
});

it("maps the bookmark list into safe material previews and requires a session", async () => {
  backend.mockResolvedValueOnce(
    Response.json({ items: [projection], nextCursor: null }),
  );
  const response = await handleBookmarkList(
    new Request("https://inside.example.test/api/bookmarks"),
  );
  const sent = expectBackendRequest(0, "POST", "/bookmarks/query");
  expect(await sent.json()).toEqual({ first: 12 });
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  const body: unknown = await response.json();
  expect(body).toMatchObject({
    items: [
      expect.objectContaining({
        materialId,
        topic: "Bookmarks",
        format: "Заметка",
        slug: "bookmark-me",
      }),
    ],
    nextCursor: null,
  });
  expect(body).not.toHaveProperty("cover", "storage-key");
});

it("returns 401 for the bookmark list without a session", async () => {
  session = await realBffSession(null);
  const response = await handleBookmarkList(
    new Request("https://inside.example.test/api/bookmarks"),
  );
  expect(response.status).toBe(401);
  expect(backend).not.toHaveBeenCalled();
});

function expectBackendRequest(
  index: number,
  method: string,
  path: string,
): Request {
  const request = backend.mock.calls[index]?.[0];
  expect(request).toBeInstanceOf(Request);
  if (request === undefined) throw new Error("Expected backend request");
  expect(request.method).toBe(method);
  expect(request.url).toBe(`https://platform-api.example.test${path}`);
  expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
  return request;
}
