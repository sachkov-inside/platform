import { beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ accessToken: vi.fn() }));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: { accessToken: session.accessToken },
  LogtoSessionUnavailableError: class extends Error {},
}));
import { loadTaskSubmissions } from "@/_pages/task-submissions/api/load-task-submissions.server";
import { LogtoSessionUnavailableError } from "@/shared/auth/session-adapter.server";
import {
  reviewedSubmissions,
  submissionsProductId,
  submissionsSecondChapter,
} from "@/storybook/task-submissions.fixtures";

beforeEach(() => {
  session.accessToken.mockReset();
  session.accessToken.mockResolvedValue("author-token");
  vi.stubEnv("BACKEND_BASE_URL", "https://backend.test");
});

it.each([
  [401, "unauthorized"],
  [403, "forbidden"],
  [503, "unavailable"],
] as const)(
  "closes backend HTTP %i without exposing submissions (#967)",
  async (status, kind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status }))),
    );
    expect(await loadTaskSubmissions({}, undefined)).toEqual({ kind });
  },
);

it("distinguishes an expired session from identity failure without reading submissions (#967)", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  session.accessToken.mockRejectedValueOnce(new LogtoSessionUnavailableError());
  expect(await loadTaskSubmissions({}, undefined)).toEqual({
    kind: "unauthorized",
  });
  session.accessToken.mockRejectedValueOnce(
    new Error("private identity failure"),
  );
  expect(await loadTaskSubmissions({}, undefined)).toEqual({
    kind: "unavailable",
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("drops a foreign chapter/task and pagination before returning the list the filters describe (#967)", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      urls.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(Response.json(reviewedSubmissions));
    }),
  );
  const outcome = await loadTaskSubmissions(
    {
      productId: submissionsProductId,
      chapterId: submissionsSecondChapter,
      taskCode: "aie-ch1-onboarding",
    },
    "page-2",
  );
  expect(outcome).toMatchObject({
    kind: "ready",
    selection: {
      productId: submissionsProductId,
      chapterId: submissionsSecondChapter,
    },
    continued: false,
    cursor: undefined,
  });
  expect(
    new URL(urls[1] ?? "https://missing.test").searchParams.has("taskCode"),
  ).toBe(false);
  expect(
    new URL(urls[1] ?? "https://missing.test").searchParams.has("cursor"),
  ).toBe(false);
});

it("recovers a malformed cursor at the newest page and rejects malformed response bodies (#967)", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 400 }))
    .mockResolvedValueOnce(Response.json(reviewedSubmissions));
  vi.stubGlobal("fetch", fetch);
  expect(await loadTaskSubmissions({}, "broken")).toMatchObject({
    kind: "ready",
    continued: false,
    cursor: undefined,
  });
  fetch.mockResolvedValueOnce(
    Response.json({ submissions: ["private incomplete record"] }),
  );
  expect(await loadTaskSubmissions({}, undefined)).toEqual({
    kind: "unavailable",
  });
});

it("reads a selected submission outside the cursor page and preserves the return cursor (#1351)", async () => {
  const id = "30000000-0000-4000-8000-000000000001";
  const fetch = vi.fn((_input: RequestInfo | URL) =>
    Promise.resolve(
      Response.json({
        ...reviewedSubmissions,
        submissions: reviewedSubmissions.submissions.filter(
          (row) => row.submissionId === id,
        ),
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await loadTaskSubmissions({}, "page-2", id)).toMatchObject({
    kind: "ready",
    cursor: "page-2",
    submissionId: id,
  });
  const input: unknown = fetch.mock.calls[0]?.[0];
  expect(input instanceof Request ? input.url : String(input)).toContain(
    `submissionId=${id}`,
  );
});
it("a malformed or missing selected submission does not fall back to an unrelated list (#1351)", async () => {
  const fetch = vi.fn(() =>
    Promise.resolve(Response.json({ ...reviewedSubmissions, submissions: [] })),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await loadTaskSubmissions({}, undefined, "broken")).toEqual({
    kind: "not_found",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(
    await loadTaskSubmissions(
      {},
      undefined,
      "30000000-0000-4000-8000-000000000999",
    ),
  ).toEqual({ kind: "not_found" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
