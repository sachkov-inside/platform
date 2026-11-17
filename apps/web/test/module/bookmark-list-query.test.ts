import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { bookmarkListQueryOptions } from "@/features/bookmarks/api/bookmarks.browser";
import * as listRoute from "../../app/api/bookmarks/route";
import { realBffSession } from "../support/real-bff-session";
import { routeBrowserMutations } from "../support/mutation-operation-route";

it("retains the projected cursor through empty pages and retries a failed continuation once", async () => {
  vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
  const scope = await realBffSession();
  const backendRequests: Request[] = [];
  let continuation = 0;
  const bridge = routeBrowserMutations(
    { "/api/bookmarks": listRoute },
    undefined,
    {
      run: scope,
      externalFetch: async (request) => {
        backendRequests.push(request);
        const input: unknown = await request.clone().json();
        if (backendRequests.length === 1)
          return Response.json({ items: [], nextCursor: "raw-next" });
        continuation += 1;
        expect(input).toEqual({ first: 12, after: "raw-next" });
        return continuation === 1
          ? new Response(null, { status: 503 })
          : Response.json({ items: [], nextCursor: null });
      },
    },
  );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const observer = new InfiniteQueryObserver(
    cache,
    bookmarkListQueryOptions("account-a"),
  );
  try {
    await observer.refetch();
    expect(observer.getCurrentResult().hasNextPage).toBe(true);
    const failed = await observer.fetchNextPage();
    expect(failed.isFetchNextPageError).toBe(true);
    expect(failed.data?.pages).toEqual([
      { kind: "ready", items: [], nextCursor: "raw-next" },
    ]);
    const retried = await observer.fetchNextPage();
    expect(retried.data?.pages).toHaveLength(2);
    expect(retried.hasNextPage).toBe(false);
    expect(bridge.requests.map((request) => request.url)).toEqual([
      "https://inside.example.test/api/bookmarks",
      "https://inside.example.test/api/bookmarks?after=raw-next",
      "https://inside.example.test/api/bookmarks?after=raw-next",
    ]);
    expect(bridge.requests.every((request) => request.method === "GET")).toBe(
      true,
    );
    expect(bridge.statuses).toEqual([200, 503, 200]);
    expect(backendRequests).toHaveLength(3);
    for (const [index, request] of backendRequests.entries()) {
      expect(request.url).toBe(
        "https://platform-api.example.test/bookmarks/query",
      );
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
      expect(await request.json()).toEqual(
        index === 0 ? { first: 12 } : { first: 12, after: "raw-next" },
      );
    }
  } finally {
    cache.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
