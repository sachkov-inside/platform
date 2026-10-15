import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({ accessToken: vi.fn(), load: vi.fn() }));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: { accessToken: fakes.accessToken },
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/_pages/product-task/api/load-product-task.server", () => ({
  loadOwnSubmissions: fakes.load,
}));
import { readTaskSubmissionsRequest } from "@/_pages/product-task/api/task-submissions-bff.server";
import { LogtoSessionUnavailableError } from "@/shared/auth/session-adapter.server";
import { readTaskSubmissions } from "@/_pages/product-task/api/read-task-submissions.browser";

beforeEach(() => {
  vi.clearAllMocks();
  fakes.accessToken.mockResolvedValue("test-token");
});
it("keeps Account history private, preserves its cursor and omits presentation-only fields", async () => {
  fakes.load.mockResolvedValue({
    kind: "ready",
    code: "task-one",
    continued: true,
    currentVersion: 1,
    reviewProgress: null,
    nextCursor: null,
    latestSubmittedAt: null,
    versions: [],
    submissions: [],
  });
  const result = await readTaskSubmissionsRequest(
    new Request(
      "https://inside.test/api/product-tasks/submissions?code=task-one&after=cursor",
    ),
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(result.headers.get("vary")).toContain("cookie");
  expect(fakes.load).toHaveBeenCalledWith("task-one", "test-token", "cursor");
  expect(await result.json()).not.toHaveProperty("continued");
});
it("does not query history without a session and distinguishes identity failure", async () => {
  fakes.accessToken.mockRejectedValueOnce(new LogtoSessionUnavailableError());
  expect(
    (
      await readTaskSubmissionsRequest(
        new Request(
          "https://inside.test/api/product-tasks/submissions?code=task-one",
        ),
      )
    ).status,
  ).toBe(401);
  fakes.accessToken.mockRejectedValueOnce(new Error("identity offline"));
  expect(
    (
      await readTaskSubmissionsRequest(
        new Request(
          "https://inside.test/api/product-tasks/submissions?code=task-one",
        ),
      )
    ).status,
  ).toBe(503);
  expect(fakes.load).not.toHaveBeenCalled();
});
it("browser reads reject dependency failures instead of replacing saved data with an empty history", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ kind: "identity_unavailable" }, { status: 503 }),
      ),
  );
  await expect(
    readTaskSubmissions("task-one", undefined, new AbortController().signal),
  ).rejects.toThrow();
});
