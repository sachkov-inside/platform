import { afterEach, expect, test, vi } from "vitest";
import { environmentManager, type QueryClient } from "@tanstack/react-query";

import { getQueryClient } from "@/shared/api/query-client";

const clients: QueryClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  environmentManager.setIsServer(() => true);
  vi.useRealTimers();
});

test("server query caches do not leave timers holding completed request data", async () => {
  vi.useFakeTimers();
  environmentManager.setIsServer(() => true);
  const first = getQueryClient();
  const second = getQueryClient();
  clients.push(first, second);
  await first.query({
    queryKey: ["request-data"],
    queryFn: () => Promise.resolve("first request"),
  });
  expect(first.getQueryData(["request-data"])).toBe("first request");
  expect(second.getQueryData(["request-data"])).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

test("browser query caches survive renders and expire inactive data after thirty minutes", async () => {
  vi.useFakeTimers();
  environmentManager.setIsServer(() => false);
  const client = getQueryClient();
  clients.push(client);
  const read = vi.fn(() => Promise.resolve("browser data"));
  const options = { queryKey: ["browser-data"], queryFn: read };
  await client.query(options);
  await vi.advanceTimersByTimeAsync(29_999);
  await getQueryClient().query(options);
  expect(read).toHaveBeenCalledTimes(1);
  expect(getQueryClient().getQueryData(options.queryKey)).toBe("browser data");
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  expect(client.getQueryData(options.queryKey)).toBeUndefined();
});
