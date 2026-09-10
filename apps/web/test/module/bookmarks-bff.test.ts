import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  states: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestBookmarks: fakes.list,
  requestBookmarkStates: fakes.states,
  requestAddBookmark: fakes.add,
  requestRemoveBookmark: fakes.remove,
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({ getPlatformAccessToken: fakes.token, LogtoSessionUnavailableError: fakes.LogtoSessionUnavailableError }));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({ readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }) }));
vi.mock("@/shared/auth/index.server", async () => {
  const handlers = await import("@/shared/auth/authenticated-mutation-handler.server");
  return {
    handleAuthenticatedMutation: handlers.handleAuthenticatedMutation,
    getPlatformAccessToken: fakes.token,
    readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
    LogtoSessionUnavailableError: fakes.LogtoSessionUnavailableError,
  };
});
import { handleBookmarkList, handleBookmarkStates, handleSetBookmark } from "@/features/bookmarks.server";

const materialId = "10000000-0000-4000-8000-000000000001";
const state = { materialId, bookmarked: true, bookmarkedAt: "2026-09-07T00:00:00.000Z" };
const projection = {
  access: "free",
  availability: "available",
  contentVersion: 1,
  cover: null,
  format: { id: "note", name: "Заметка", slug: "note" },
  materialId,
  primaryVideoId: null,
  publishedAt: "2026-09-07T00:00:00.000Z",
  seriesMemberships: [],
  slug: "bookmark-me",
  summary: "Материал для проверки закладок.",
  tags: [],
  title: "Закладка",
  topic: { id: "20000000-0000-4000-8000-000000000001", name: "Bookmarks", slug: "bookmarks" },
};

function mutation(values: Record<string, string>, origin = "https://inside.example.test") {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return new Request("https://inside.example.test/api/bookmarks/state", { method: "PUT", headers: { origin }, body });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

it("rejects cross-origin writes before authentication or backend calls", async () => {
  const response = await handleSetBookmark(mutation({ materialId, bookmarked: "true" }, "https://outside.test"));
  expect(response.status).toBe(403);
  expect(fakes.token).not.toHaveBeenCalled();
  expect(fakes.add).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("no-store, private");
});

it("routes the desired bookmark state to add or remove without trusting posted identity", async () => {
  fakes.add.mockResolvedValue({ ok: true, body: state, response: new Response() });
  fakes.remove.mockResolvedValue({ ok: true, body: { materialId, bookmarked: false, bookmarkedAt: null }, response: new Response() });
  const added = await handleSetBookmark(mutation({ materialId, bookmarked: "true", accountId: "untrusted" }));
  expect(fakes.add).toHaveBeenCalledWith(materialId, "trusted-token");
  expect(await added.json()).toEqual({ kind: "ready", state });
  const removed = await handleSetBookmark(mutation({ materialId, bookmarked: "false" }));
  expect(fakes.remove).toHaveBeenCalledWith(materialId, "trusted-token");
  expect(await removed.json()).toEqual({ kind: "ready", state: { materialId, bookmarked: false, bookmarkedAt: null } });
});

it("reports denied and unavailable without claiming a saved bookmark", async () => {
  fakes.add.mockResolvedValueOnce({ ok: false, problem: { code: "access_denied" }, response: new Response(null, { status: 403 }) });
  expect(await (await handleSetBookmark(mutation({ materialId, bookmarked: "true" }))).json()).toEqual({ kind: "denied" });
  fakes.add.mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({ ok: true, body: { bookmarked: true }, response: new Response() });
  for (let index = 0; index < 2; index += 1) {
    expect(await (await handleSetBookmark(mutation({ materialId, bookmarked: "true" }))).json()).toEqual({ kind: "unavailable" });
  }
});

it("bounds and validates bookmark state batches", async () => {
  fakes.states.mockResolvedValue({ ok: true, body: [state], response: new Response() });
  const response = await handleBookmarkStates(mutation({ materialId }));
  expect(await response.json()).toEqual({ kind: "ready", states: [state] });
  expect(fakes.states).toHaveBeenCalledWith([materialId], "trusted-token");
  const body = new FormData();
  for (let index = 0; index < 101; index += 1) body.append("materialId", materialId);
  expect(await (await handleBookmarkStates(new Request("https://inside.example.test/api/bookmarks/states", { method: "POST", headers: { origin: "https://inside.example.test" }, body }))).json()).toEqual({ kind: "invalid_input" });
  expect(fakes.states).toHaveBeenCalledTimes(1);
});

it("maps the bookmark list into safe material previews and requires a session", async () => {
  fakes.list.mockResolvedValue({ ok: true, body: { items: [projection], nextCursor: null }, response: new Response() });
  const response = await handleBookmarkList(new Request("https://inside.example.test/api/bookmarks"));
  expect(fakes.list).toHaveBeenCalledWith({}, "trusted-token");
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  const body = (await response.json()) as { items: { materialId: string; topic: string; cover?: unknown }[]; nextCursor: null };
  expect(body.items).toEqual([expect.objectContaining({ materialId, topic: "Bookmarks", format: "Заметка", slug: "bookmark-me" })]);
  expect(body).not.toHaveProperty("cover", "storage-key");
  expect(body.nextCursor).toBeNull();
});

it("returns 401 for the bookmark list without a session", async () => {
  fakes.token.mockRejectedValueOnce(new fakes.LogtoSessionUnavailableError());
  const response = await handleBookmarkList(new Request("https://inside.example.test/api/bookmarks"));
  expect(response.status).toBe(401);
  expect(fakes.list).not.toHaveBeenCalled();
});
