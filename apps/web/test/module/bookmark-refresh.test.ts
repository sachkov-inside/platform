import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { refreshBookmarks } from "@/features/bookmarks/model/bookmark-events";

function heldRead() {
  let begin: () => void = () => undefined;
  let deliver: (value: string) => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const answer = new Promise<string>((resolve) => {
    deliver = resolve;
  });
  return {
    started,
    deliver: (value: string) => {
      deliver(value);
    },
    run: () => {
      begin();
      return answer;
    },
  };
}

it("joins the same write but supersedes a read when another bookmark write arrives", async () => {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const initial = heldRead();
  const afterFirst = heldRead();
  const afterSecond = heldRead();
  const reads = [initial, afterFirst, afterSecond];
  let requests = 0;
  const observer = new QueryObserver(cache, {
    queryKey: ["bookmarks", "account-a", "list"],
    queryFn: () => {
      const read = reads[requests];
      requests += 1;
      if (read === undefined)
        throw new Error("Unexpected fourth bookmark read");
      return read.run();
    },
  });
  const stop = observer.subscribe(() => undefined);
  try {
    await initial.started;
    const first = refreshBookmarks(cache, "account-a", "write-1");
    await afterFirst.started;
    expect(refreshBookmarks(cache, "account-a", "write-1")).toBe(first);
    const latest = refreshBookmarks(cache, "account-a", "write-2");
    await afterSecond.started;
    initial.deliver("before write");
    afterFirst.deliver("first write");
    afterSecond.deliver("second write");
    await latest;
    await first;
    expect(observer.getCurrentResult().data).toBe("second write");
    expect(requests).toBe(3);
  } finally {
    reads.forEach((read) => {
      read.deliver("cleanup");
    });
    stop();
    cache.clear();
  }
});
