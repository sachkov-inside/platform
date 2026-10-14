import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { loadOwnSubmissions } from "@/_pages/product-task/api/load-product-task.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test("the private history adapter retains continuation and requests the selected older page", async () => {
  vi.stubEnv("BACKEND_BASE_URL", "https://api.example.test");
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      code: "history-task",
      currentVersion: 1,
      versions: [],
      submissions: [],
      nextCursor: "older-page",
      latestSubmittedAt: null,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(
    await loadOwnSubmissions("history-task", "reader-token", "current-page"),
  ).toEqual({
    kind: "ready",
    code: "history-task",
    currentVersion: 1,
    versions: [],
    submissions: [],
    nextCursor: "older-page",
    latestSubmittedAt: null,
    continued: true,
  });
  const request = z.instanceof(Request).parse(fetch.mock.calls[0]?.[0]);
  expect(new URL(request.url).searchParams.get("after")).toBe("current-page");
  expect(request.headers.get("authorization")).toBe("Bearer reader-token");
});

test("a failed older page can be retried at the same continuation", async () => {
  vi.stubEnv("BACKEND_BASE_URL", "https://api.example.test");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ code: "dependency_unavailable" }, { status: 503 }),
    )
    .mockResolvedValueOnce(
      Response.json({
        code: "history-task",
        currentVersion: 1,
        versions: [],
        submissions: [],
        nextCursor: null,
        latestSubmittedAt: "2026-10-02T00:00:00.000Z",
      }),
    );
  vi.stubGlobal("fetch", fetch);
  expect(
    await loadOwnSubmissions("history-task", "reader-token", "same-page"),
  ).toEqual({ kind: "unavailable" });
  expect(
    await loadOwnSubmissions("history-task", "reader-token", "same-page"),
  ).toMatchObject({ kind: "ready", nextCursor: null, continued: true });
  const requests = fetch.mock.calls.map((call) =>
    z.instanceof(Request).parse(call[0]),
  );
  expect(
    requests.map((request) => new URL(request.url).searchParams.get("after")),
  ).toEqual(["same-page", "same-page"]);
});

test("a guest makes no own-history request even with a continuation", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    await loadOwnSubmissions("history-task", undefined, "private-page"),
  ).toEqual({ kind: "guest" });
  expect(fetch).not.toHaveBeenCalled();
});
