import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  save: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", async () => {
  const transport = await import("@/shared/api/backend/transport-core.server");
  return {
    BackendConnectionError: transport.BackendConnectionError,
    requestSaveAuthorTaskFeedback: fakes.save,
  };
});
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.token,
  LogtoSessionUnavailableError: fakes.LogtoSessionUnavailableError,
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));
vi.mock("@/shared/auth/index.server", async () => {
  const handlers =
    await import("@/shared/auth/authenticated-mutation-handler.server");
  return { handleAuthenticatedMutation: handlers.handleAuthenticatedMutation };
});
import { handleSaveAuthorFeedback } from "@/_pages/task-submissions/api/save-author-feedback-route.server";
import {
  consistentSelection,
  repositoryLink,
  selectionHref,
  type FilterGuide,
} from "@/_pages/task-submissions/model/task-submissions";

const submissionId = "30000000-0000-4000-8000-000000000001";

function feedback(
  values: Record<string, string>,
  origin = "https://inside.example.test",
) {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return new Request(
    "https://inside.example.test/api/authoring/guide-tasks/feedback",
    { method: "PUT", headers: { origin }, body },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

describe("author feedback BFF (#948)", () => {
  it("refuses a cross-origin save before the session or the backend", async () => {
    const response = await handleSaveAuthorFeedback(
      feedback(
        { submissionId, comment: "x", reviewed: "true" },
        "https://outside.test",
      ),
    );
    expect(response.status).toBe(403);
    expect(fakes.token).not.toHaveBeenCalled();
    expect(fakes.save).not.toHaveBeenCalled();
  });

  it("forwards the comment as typed and the mark with the trusted token; the backend owns trimming", async () => {
    const stored = {
      comment: "Хорошее разделение.",
      reviewedAt: "2026-10-05T16:40:00.000Z",
      updatedAt: "2026-10-05T16:40:00.000Z",
    };
    fakes.save.mockResolvedValue({
      ok: true,
      body: { authorFeedback: stored },
      response: new Response(),
    });
    const response = await handleSaveAuthorFeedback(
      feedback({
        submissionId,
        comment: "  Хорошее разделение.  ",
        reviewed: "true",
      }),
    );
    expect(fakes.save).toHaveBeenCalledWith(
      submissionId,
      { comment: "  Хорошее разделение.  ", reviewed: true },
      "trusted-token",
    );
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual({
      kind: "saved",
      authorFeedback: stored,
    });

    fakes.save.mockResolvedValue({
      ok: true,
      body: { authorFeedback: null },
      response: new Response(),
    });
    await handleSaveAuthorFeedback(
      feedback({ submissionId, comment: "   ", reviewed: "false" }),
    );
    expect(fakes.save).toHaveBeenLastCalledWith(
      submissionId,
      { comment: "   ", reviewed: false },
      "trusted-token",
    );
  });

  it("refuses a malformed save without calling the backend", async () => {
    for (const values of [
      { submissionId: "not-a-uuid", comment: "", reviewed: "true" },
      { submissionId, comment: "", reviewed: "yes" },
      { submissionId, comment: "x".repeat(4_001), reviewed: "true" },
    ]) {
      const response = await handleSaveAuthorFeedback(feedback(values));
      expect(await response.json()).toEqual({ kind: "invalid_input" });
    }
    expect(fakes.save).not.toHaveBeenCalled();
  });

  it.each([
    [400, { kind: "invalid_input" }],
    [401, { kind: "unauthorized" }],
    [403, { kind: "forbidden" }],
    [404, { kind: "submission_not_found" }],
    [503, { kind: "unavailable" }],
  ])("maps backend status %i to a form outcome", async (status, outcome) => {
    fakes.save.mockResolvedValue({
      ok: false,
      problem: { code: "x" },
      response: new Response(null, { status }),
    });
    const response = await handleSaveAuthorFeedback(
      feedback({ submissionId, comment: "", reviewed: "true" }),
    );
    expect(await response.json()).toEqual(outcome);
  });
});

describe("submission filter (#948)", () => {
  const guides: FilterGuide[] = [
    {
      id: "g1",
      name: "AI Engineering",
      chapters: [
        { id: "c1", name: "Глава 1", tasks: [{ code: "t1", title: "Один" }] },
        { id: "c2", name: "Глава 2", tasks: [{ code: "t2", title: "Два" }] },
      ],
    },
    {
      id: "g2",
      name: "Other",
      chapters: [
        { id: "c3", name: "Чужая", tasks: [{ code: "t3", title: "Три" }] },
      ],
    },
  ];

  it("keeps a filter the Guides on offer can show", () => {
    expect(
      consistentSelection(
        { guideId: "g1", chapterId: "c2", taskCode: "t2" },
        guides,
      ),
    ).toEqual({ guideId: "g1", chapterId: "c2", taskCode: "t2" });
    expect(consistentSelection({ taskCode: "t3" }, guides)).toEqual({
      taskCode: "t3",
    });
  });

  it("drops a chapter of another Guide, a task of another chapter and unknown values", () => {
    expect(
      consistentSelection({ guideId: "g1", chapterId: "c3" }, guides),
    ).toEqual({ guideId: "g1" });
    expect(
      consistentSelection(
        { guideId: "g1", chapterId: "c1", taskCode: "t2" },
        guides,
      ),
    ).toEqual({ guideId: "g1", chapterId: "c1" });
    expect(consistentSelection({ chapterId: "c1" }, guides)).toEqual({});
    expect(consistentSelection({ guideId: "broken" }, guides)).toEqual({});
  });

  it("builds the address of a filtered page", () => {
    expect(selectionHref({})).toBe("/authoring/submissions");
    expect(selectionHref({ guideId: "g1", taskCode: "t1" }, "next-page")).toBe(
      "/authoring/submissions?guideId=g1&task=t1&cursor=next-page",
    );
  });

  it("links a repository only by a web address", () => {
    expect(repositoryLink("https://github.com/learner/requests")).toBe(
      "https://github.com/learner/requests",
    );
    expect(repositoryLink("javascript:alert(1)")).toBeNull();
    expect(repositoryLink("git@github.com:learner/requests.git")).toBeNull();
    expect(repositoryLink(null)).toBeNull();
  });
});
