import { QueryClient } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({ resolve: vi.fn(), read: vi.fn() }));
vi.mock("@/shared/api/backend/index.server", async () => {
  const { BackendConnectionError } =
    await import("@/shared/api/backend/transport-core.server");
  return {
    BackendConnectionError,
    resolveAccount: fakes.resolve,
    requestOwnTaskSubmissions: fakes.read,
    requestProductTaskPage: vi.fn(),
  };
});
import { BackendConnectionError } from "@/shared/api/backend/index.server";
import { prefetchOwnTaskSubmissions } from "@/_pages/product-task/api/load-product-task.server";
beforeEach(() => {
  vi.clearAllMocks();
});
it("does not read or cache personal history when Account resolution fails; a retry redoes identity", async () => {
  const client = new QueryClient();
  fakes.resolve.mockRejectedValueOnce(
    new BackendConnectionError("unavailable", "identity dependency"),
  );
  expect(await prefetchOwnTaskSubmissions(client, "task-one", "token")).toEqual(
    { accountId: null, submissions: { kind: "unavailable" } },
  );
  expect(fakes.read).not.toHaveBeenCalled();
  expect(client.getQueryCache().findAll()).toHaveLength(0);
  fakes.resolve.mockResolvedValueOnce({ accountId: "account-one" });
  fakes.read.mockResolvedValueOnce({
    ok: true,
    body: {
      code: "task-one",
      currentVersion: 1,
      reviewProgress: null,
      latestSubmittedAt: null,
      nextCursor: null,
      versions: [],
      submissions: [],
    },
  });
  expect(
    await prefetchOwnTaskSubmissions(client, "task-one", "token"),
  ).toMatchObject({ accountId: "account-one", submissions: { kind: "ready" } });
  expect(
    client
      .getQueryCache()
      .findAll()
      .map((query) => query.queryKey),
  ).toEqual([["own-task-submissions", "account-one", "task-one", null]]);
});
