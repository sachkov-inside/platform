import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  routeBrowserMutations,
  testSiteOrigin,
} from "../support/mutation-operation-route";
import { realBffSession } from "../support/real-bff-session";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
import {
  interceptIdentityOutage,
  expectIdentityOutage,
} from "../support/identity-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let scope: Awaited<ReturnType<typeof realBffSession>>;
import { readTaskSubmissionsRequest as realReadTaskSubmissionsRequest } from "@/_pages/product-task/api/task-submissions-bff.server";
import { readTaskSubmissions } from "@/_pages/product-task/api/read-task-submissions.browser";

const readTaskSubmissionsRequest = (request: Request) =>
  scope(() => realReadTaskSubmissionsRequest(request));
beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession("test-token");
  interceptBackendHttp(backend);
});
afterEach(() => vi.useRealTimers());
it("keeps Account history private, preserves its cursor and omits presentation-only fields", async () => {
  backend.mockResolvedValue(
    Response.json({
      code: "task-one",
      currentVersion: 1,
      reviewProgress: null,
      nextCursor: null,
      latestSubmittedAt: null,
      versions: [],
      submissions: [],
    }),
  );
  const result = await readTaskSubmissionsRequest(
    new Request(
      "https://inside.test/api/product-tasks/submissions?code=task-one&after=cursor",
    ),
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(result.headers.get("vary")).toContain("cookie");
  expectSingleBackendRequest(
    backend,
    "GET",
    "/accounts/current/product-tasks/task-one/submissions?after=cursor",
    "test-token",
  );
  expect(await result.json()).not.toHaveProperty("continued");
});
it("does not query history without a session and distinguishes identity failure", async () => {
  scope = await realBffSession(null);
  const identity = interceptIdentityOutage();
  expect(
    (
      await readTaskSubmissionsRequest(
        new Request(
          "https://inside.test/api/product-tasks/submissions?code=task-one",
        ),
      )
    ).status,
  ).toBe(401);
  expect(identity).not.toHaveBeenCalled();
  scope = await realBffSession({
    refreshToken: "failed-task-history-identity",
  });
  expect(
    (
      await readTaskSubmissionsRequest(
        new Request(
          "https://inside.test/api/product-tasks/submissions?code=task-one",
        ),
      )
    ).status,
  ).toBe(503);
  expectIdentityOutage(identity);
  expect(backend).not.toHaveBeenCalled();
});
it("browser reads reject dependency failures instead of replacing saved data with an empty history", async () => {
  scope = await realBffSession({
    refreshToken: "failed-browser-history-identity",
  });
  const identity = interceptIdentityOutage();
  const bridge = routeBrowserMutations(
    {
      "/api/product-tasks/submissions": { GET: realReadTaskSubmissionsRequest },
    },
    testSiteOrigin,
    { externalFetch: identity, run: (run) => scope(run) },
  );
  await expect(
    readTaskSubmissions("task-one", undefined, new AbortController().signal),
  ).rejects.toThrow();
  expect(
    bridge.requests.map((request) => ({
      method: request.method,
      url: request.url,
    })),
  ).toEqual([
    {
      method: "GET",
      url: "https://inside.example.test/api/product-tasks/submissions?code=task-one",
    },
  ]);
  expect(bridge.statuses).toEqual([503]);
  expectIdentityOutage(identity);
  expect(backend).not.toHaveBeenCalled();
});
