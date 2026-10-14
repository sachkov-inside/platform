import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { bookmarkListQueryOptions } from "@/features/bookmarks/api/bookmarks.browser";

it("retains the projected cursor through empty pages and retries a failed continuation once", async () => {
  const requests: string[] = [];
  let continuation = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      requests.push(url);
      if (!url.includes("after="))
        return Promise.resolve(
          Response.json({ items: [], nextCursor: "raw-next" }),
        );
      continuation += 1;
      return Promise.resolve(
        continuation === 1
          ? new Response(null, { status: 503 })
          : Response.json({ items: [], nextCursor: null }),
      );
    }),
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
    expect(requests).toEqual([
      "/api/bookmarks",
      "/api/bookmarks?after=raw-next",
      "/api/bookmarks?after=raw-next",
    ]);
  } finally {
    cache.clear();
  }
});
