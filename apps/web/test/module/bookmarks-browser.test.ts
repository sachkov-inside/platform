import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as listRoute from "../../app/api/bookmarks/route";
import * as statesRoute from "../../app/api/bookmarks/states/route";
import * as stateRoute from "../../app/api/bookmarks/state/route";
import { realBffSession } from "../support/real-bff-session";
import {
  routeBrowserMutations,
  testSiteOrigin,
} from "../support/mutation-operation-route";
import {
  getBookmarkStates,
  listBookmarkPage,
  setBookmark,
} from "@/features/bookmarks";
import { bookmarkStatesQueryOptions } from "@/features/bookmarks/api/bookmarks.browser";

const materialId = "10000000-0000-4000-8000-000000000001";
const state = {
  materialId,
  bookmarked: true,
  bookmarkedAt: "2026-09-10T00:00:00.000Z",
};
const expectedState = {
  materialId: "10000000-0000-4000-8000-000000000001",
  bookmarked: true,
  bookmarkedAt: "2026-09-10T00:00:00.000Z",
};
const routes = {
  "/api/bookmarks": listRoute,
  "/api/bookmarks/states": statesRoute,
  "/api/bookmarks/state": stateRoute,
};
interface BackendRead {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}
const backend = vi.fn<(request: Request) => Promise<Response>>();
let expected: BackendRead[];
let scope: Awaited<ReturnType<typeof realBffSession>>;
let browser: ReturnType<typeof connectBrowser>;
function reply(
  method: string,
  path: string,
  body: unknown,
  status = 200,
  requestBody?: unknown,
) {
  expected.push({
    method,
    path,
    ...(requestBody === undefined ? {} : { body: requestBody }),
  });
  backend.mockResolvedValueOnce(Response.json(body, { status }));
}
function connectBrowser(corruption?: "missing-ready-state") {
  const bridge = routeBrowserMutations(routes, testSiteOrigin, {
    externalFetch: backend,
    run: (handler) => scope(handler),
  });
  let corruptions = 0;
  if (corruption === "missing-ready-state") {
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
          testSiteOrigin,
        );
        const method =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        // deterministic-test-allow unit-io: #2292 audit2 worker7e1496b5; this in-process bridge calls real app handlers, no network, under the accepted named wire-fault boundary.
        const response = await bridge.fetch(input, init);
        if (
          url.href !== "https://inside.example.test/api/bookmarks/state" ||
          method !== "PUT"
        )
          return response;
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          kind: "ready",
          state: expectedState,
        });
        expect(response.bodyUsed).toBe(true);
        corruptions += 1;
        return new Response('{"bookmarked":true}', {
          status: response.status,
          headers: response.headers,
        });
      },
    );
  }
  return { ...bridge, corruptions: () => corruptions };
}
beforeEach(async () => {
  vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
  scope = await realBffSession();
  expected = [];
  backend.mockReset();
  backend.mockRejectedValue(new Error("Unexpected external backend request"));
  browser = connectBrowser();
});
afterEach(async () => {
  try {
    expect(backend).toHaveBeenCalledTimes(expected.length);
    for (const [index, read] of expected.entries()) {
      const request = backend.mock.calls[index]?.[0];
      if (request === undefined) throw new Error("Expected backend request");
      expect(request.method).toBe(read.method);
      expect(request.url).toBe(`https://platform-api.example.test${read.path}`);
      expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
      if (read.body === undefined) expect(request.body).toBeNull();
      else expect(await request.json()).toEqual(read.body);
    }
    for (const request of browser.requests)
      expect([
        "GET https://inside.example.test/api/bookmarks",
        "POST https://inside.example.test/api/bookmarks/states",
        "PUT https://inside.example.test/api/bookmarks/state",
      ]).toContain(`${request.method} ${request.url}`);
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe("Bookmarks browser contract", () => {
  it("asks for bookmark states only with an account", () => {
    expect(
      bookmarkStatesQueryOptions({ materialId, accountId: null }).enabled,
    ).toBe(false);
    expect(
      bookmarkStatesQueryOptions({ materialId, accountId: "account-a" })
        .enabled,
    ).toBe(true);
  });
  it("does not reuse Account A's bookmark state for Account B", () => {
    const a = bookmarkStatesQueryOptions({
      materialId,
      accountId: "account-a",
    });
    const b = bookmarkStatesQueryOptions({
      materialId,
      accountId: "account-b",
    });
    expect(a.queryKey).not.toEqual(b.queryKey);
  });
  it("reads the ready states wrapper instead of treating the bookmark as unavailable", async () => {
    reply("POST", "/bookmarks/materials/query", [state], 200, {
      materialIds: ["10000000-0000-4000-8000-000000000001"],
    });
    await expect(getBookmarkStates([materialId])).resolves.toEqual({
      kind: "ready",
      states: [expectedState],
    });
    expect(browser.statuses).toEqual([200]);
    expect(browser.corruptions()).toBe(0);
  });
  it("reads the ready state wrapper when saving a bookmark", async () => {
    reply(
      "PUT",
      "/bookmarks/materials/10000000-0000-4000-8000-000000000001",
      state,
    );
    await expect(
      setBookmark({ materialId, bookmarked: true }),
    ).resolves.toEqual({ kind: "ready", state: expectedState });
    expect(browser.statuses).toEqual([200]);
    expect(browser.corruptions()).toBe(0);
    expect(await browser.requests[0]?.json()).toEqual({
      materialId: "10000000-0000-4000-8000-000000000001",
      bookmarked: true,
    });
  });
  it("preserves a denied save through the real handler", async () => {
    reply(
      "PUT",
      "/bookmarks/materials/10000000-0000-4000-8000-000000000001",
      { code: "forbidden", status: 403 },
      403,
    );
    await expect(
      setBookmark({ materialId, bookmarked: true }),
    ).resolves.toEqual({ kind: "denied" });
    expect(browser.statuses).toEqual([200]);
    expect(browser.corruptions()).toBe(0);
  });
  it("rejects malformed successful save bytes after a validated real response (transport corruption)", async () => {
    reply(
      "PUT",
      "/bookmarks/materials/10000000-0000-4000-8000-000000000001",
      state,
    );
    browser = connectBrowser("missing-ready-state");
    await expect(
      setBookmark({ materialId, bookmarked: true }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(browser.statuses).toEqual([200]);
    expect(browser.corruptions()).toBe(1);
    expect(browser.requests).toHaveLength(1);
  });
  it("keeps malformed external backend data separate from transport corruption", async () => {
    reply("PUT", "/bookmarks/materials/10000000-0000-4000-8000-000000000001", {
      bookmarked: true,
    });
    await expect(
      setBookmark({ materialId, bookmarked: true }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(browser.statuses).toEqual([200]);
    expect(browser.corruptions()).toBe(0);
  });
  it("maps the list page and an unauthorised session", async () => {
    reply("POST", "/bookmarks/query", { items: [], nextCursor: null }, 200, {
      first: 12,
    });
    await expect(listBookmarkPage()).resolves.toEqual({
      kind: "ready",
      items: [],
      nextCursor: null,
    });
    scope = await realBffSession(null);
    await expect(listBookmarkPage()).resolves.toEqual({ kind: "unauthorized" });
    expect(browser.statuses).toEqual([200, 401]);
  });
});
