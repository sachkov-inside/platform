import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reviewedSubmissions } from "@/storybook/task-submissions.fixtures";
import { configureWebRuntime } from "../support/web-runtime";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let client: QueryClient | undefined;
import { prefetchOwnTaskSubmissions } from "@/_pages/product-task/api/load-product-task.server";
beforeEach(() => {
  backend.mockReset();
  configureWebRuntime();
  interceptBackendHttp(backend);
});
afterEach(() => client?.clear());
it("does not read or cache personal history when Account resolution fails; a retry redoes identity", async () => {
  client = new QueryClient();
  backend.mockRejectedValueOnce(
    new TypeError("identity dependency unavailable"),
  );
  expect(await prefetchOwnTaskSubmissions(client, "task-one", "token")).toEqual(
    { accountId: null, submissions: { kind: "unavailable" } },
  );
  expectSingleBackendRequest(backend, "GET", "/accounts/current", "token");
  expect(client.getQueryCache().findAll()).toHaveLength(0);
  const accountId = reviewedSubmissions.submissions[0]?.person.accountId;
  if (accountId === undefined)
    throw new Error("Expected existing Account fixture");
  backend.mockResolvedValueOnce(Response.json({ account: { accountId } }));
  backend.mockResolvedValueOnce(
    Response.json({
      code: "task-one",
      currentVersion: 1,
      reviewProgress: null,
      latestSubmittedAt: null,
      nextCursor: null,
      versions: [],
      submissions: [],
    }),
  );
  expect(
    await prefetchOwnTaskSubmissions(client, "task-one", "token"),
  ).toMatchObject({
    accountId: "10000000-0000-4000-8000-000000000001",
    submissions: { kind: "ready" },
  });
  expect(backend).toHaveBeenCalledTimes(3);
  expect(
    backend.mock.calls.map(([request]) => ({
      method: request.method,
      url: request.url,
      authorization: request.headers.get("authorization"),
    })),
  ).toEqual([
    {
      method: "GET",
      url: "https://platform-api.example.test/accounts/current",
      authorization: "Bearer token",
    },
    {
      method: "GET",
      url: "https://platform-api.example.test/accounts/current",
      authorization: "Bearer token",
    },
    {
      method: "GET",
      url: "https://platform-api.example.test/accounts/current/product-tasks/task-one/submissions",
      authorization: "Bearer token",
    },
  ]);
  expect(
    client
      .getQueryCache()
      .findAll()
      .map((query) => query.queryKey),
  ).toEqual([
    [
      "own-task-submissions",
      "10000000-0000-4000-8000-000000000001",
      "task-one",
      null,
    ],
  ]);
});
