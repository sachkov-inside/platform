import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";
import {
  interceptIdentityOutage,
  expectIdentityOutage,
} from "../support/identity-http";
let backendRequests: Request[] = [];
let scope: Awaited<ReturnType<typeof realBffSession>>;
import { loadTaskSubmissions as realLoadTaskSubmissions } from "@/_pages/task-submissions/api/load-task-submissions.server";
import {
  reviewedSubmissions,
  submissionsProductId,
  submissionsSecondChapter,
} from "@/storybook/task-submissions.fixtures";

const loadTaskSubmissions = (
  ...args: Parameters<typeof realLoadTaskSubmissions>
) => scope(() => realLoadTaskSubmissions(...args));
beforeEach(async () => {
  backendRequests = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession("author-token");
});
afterEach(() => {
  vi.useRealTimers();
  for (const request of backendRequests) {
    expect(new URL(request.url).origin).toBe(
      "https://platform-api.example.test",
    );
    expect(request.method).toBe("GET");
    expect(request.headers.get("authorization")).toBe("Bearer author-token");
  }
});

it.each([
  [401, "unauthorized"],
  [403, "forbidden"],
  [503, "unavailable"],
] as const)(
  "closes backend HTTP %i without exposing submissions (#967)",
  async (status, kind) => {
    stubBackend(vi.fn(() => Promise.resolve(new Response(null, { status }))));
    expect(await loadTaskSubmissions({}, undefined)).toEqual({ kind });
  },
);

it("distinguishes an expired session from identity failure without reading submissions (#967)", async () => {
  const fetch = vi.fn();
  stubBackend(fetch);
  scope = await realBffSession(null);
  expect(await loadTaskSubmissions({}, undefined)).toEqual({
    kind: "unauthorized",
  });
  expect(fetch).not.toHaveBeenCalled();
  scope = await realBffSession({ refreshToken: "failed-author-task-identity" });
  const identity = interceptIdentityOutage();
  expect(await loadTaskSubmissions({}, undefined)).toEqual({
    kind: "unavailable",
  });
  expect(fetch).not.toHaveBeenCalled();
  expectIdentityOutage(identity);
});

it("drops a foreign chapter/task and pagination before returning the list the filters describe (#967)", async () => {
  const urls: string[] = [];
  stubBackend(
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
      productId: "00000000-0000-4000-8000-000000000948",
      chapterId: "00000000-0000-4000-8000-000000000950",
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
  stubBackend(fetch);
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
  stubBackend(fetch);
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
  stubBackend(fetch);
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

it("sends the feedback filter with list reads and the cursor, and none for «все сдачи» (#1717)", async () => {
  const urls: URL[] = [];
  stubBackend(
    vi.fn((input: RequestInfo | URL) => {
      urls.push(
        new URL(input instanceof Request ? input.url : input.toString()),
      );
      return Promise.resolve(Response.json(reviewedSubmissions));
    }),
  );
  expect(await loadTaskSubmissions({}, undefined)).toMatchObject({
    kind: "ready",
    feedback: "awaiting",
  });
  expect(urls[0]?.searchParams.get("feedback")).toBe("awaiting");
  expect(
    await loadTaskSubmissions({}, "page-2", undefined, undefined, "given"),
  ).toMatchObject({ kind: "ready", feedback: "given", cursor: "page-2" });
  expect(urls[1]?.searchParams.get("feedback")).toBe("given");
  expect(urls[1]?.searchParams.get("cursor")).toBe("page-2");
  expect(
    await loadTaskSubmissions({}, undefined, undefined, undefined, "all"),
  ).toMatchObject({ kind: "ready", feedback: "all" });
  expect(urls[2]?.searchParams.has("feedback")).toBe(false);
});

it("opens a submission chosen in the «без комментария» view after it was commented (#1717)", async () => {
  const id = "30000000-0000-4000-8000-000000000002";
  const urls: URL[] = [];
  stubBackend(
    vi.fn((input: RequestInfo | URL) => {
      urls.push(
        new URL(input instanceof Request ? input.url : input.toString()),
      );
      return Promise.resolve(
        Response.json({
          ...reviewedSubmissions,
          submissions: reviewedSubmissions.submissions.filter(
            (row) => row.submissionId === id,
          ),
        }),
      );
    }),
  );
  expect(
    await loadTaskSubmissions({}, undefined, id, undefined, "awaiting"),
  ).toMatchObject({ kind: "ready", submissionId: id, feedback: "awaiting" });
  expect(urls).toHaveLength(1);
  expect(urls[0]?.searchParams.get("submissionId")).toBe(id);
  expect(urls[0]?.searchParams.has("feedback")).toBe(false);
});

it("keeps the feedback choice when a stale address falls back to the whole list (#1717)", async () => {
  const urls: URL[] = [];
  stubBackend(
    vi
      .fn()
      .mockImplementationOnce((input: RequestInfo | URL) => {
        urls.push(
          new URL(input instanceof Request ? input.url : input.toString()),
        );
        return Promise.resolve(new Response(null, { status: 400 }));
      })
      .mockImplementationOnce((input: RequestInfo | URL) => {
        urls.push(
          new URL(input instanceof Request ? input.url : input.toString()),
        );
        return Promise.resolve(Response.json(reviewedSubmissions));
      }),
  );
  expect(
    await loadTaskSubmissions({}, "broken", undefined, undefined, "given"),
  ).toMatchObject({ kind: "ready", feedback: "given", cursor: undefined });
  expect(urls[1]?.searchParams.get("feedback")).toBe("given");
  expect(urls[1]?.searchParams.has("cursor")).toBe(false);
});

function stubBackend(reply: typeof globalThis.fetch): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    backendRequests.push(request.clone());
    return reply(request);
  });
}
