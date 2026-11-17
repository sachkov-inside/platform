import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let scope: Awaited<ReturnType<typeof realBffSession>>;
import { handleSaveAuthorFeedback as realHandleSaveAuthorFeedback } from "@/_pages/task-submissions/api/save-author-feedback-route.server";
import {
  consistentSelection,
  repositoryLink,
  submissionsListHref,
  type FilterProduct,
} from "@/_pages/task-submissions/model/task-submissions";

const handleSaveAuthorFeedback = (request: Request) =>
  scope(() => realHandleSaveAuthorFeedback(request));

const submissionId = "30000000-0000-4000-8000-000000000001";

function feedback(
  values: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  return new Request(
    "https://inside.example.test/api/authoring/product-tasks/feedback",
    {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(values),
    },
  );
}

beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession();
  interceptBackendHttp(backend);
});
afterEach(() => vi.useRealTimers());

describe("author feedback BFF (#948)", () => {
  it("refuses a cross-origin save before the session or the backend", async () => {
    const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
    const response = await handleSaveAuthorFeedback(
      feedback(
        { submissionId, comment: "x", reviewed: true },
        "https://outside.test",
      ),
    );
    expect(response.status).toBe(403);
    expect(tokenReads).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
  });

  it("forwards the comment as typed and the mark with the trusted token; the backend owns trimming", async () => {
    const stored = {
      comment: "Хорошее разделение.",
      reviewedAt: "2026-10-05T16:40:00.000Z",
      updatedAt: "2026-10-05T16:40:00.000Z",
    };
    backend.mockResolvedValueOnce(
      Response.json({ authorFeedback: stored }, { status: 200 }),
    );
    const response = await handleSaveAuthorFeedback(
      feedback({
        submissionId,
        comment: "  Хорошее разделение.  ",
        reviewed: true,
      }),
    );
    expect(
      await expectSingleBackendRequest(
        backend,
        "PUT",
        `/authoring/product-tasks/submissions/${submissionId}/feedback`,
      ).json(),
    ).toEqual({ comment: "  Хорошее разделение.  ", reviewed: true });
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual({
      kind: "saved",
      authorFeedback: {
        comment: "Хорошее разделение.",
        reviewedAt: "2026-10-05T16:40:00.000Z",
        updatedAt: "2026-10-05T16:40:00.000Z",
      },
    });

    backend.mockResolvedValueOnce(
      Response.json({ authorFeedback: null }, { status: 200 }),
    );
    await handleSaveAuthorFeedback(
      feedback({ submissionId, comment: "   ", reviewed: false }),
    );
    expect(backend).toHaveBeenCalledTimes(2);
    const cleared = backend.mock.lastCall?.[0];
    expect(cleared?.method).toBe("PUT");
    expect(cleared?.url).toBe(
      `https://platform-api.example.test/authoring/product-tasks/submissions/${submissionId}/feedback`,
    );
    expect(cleared?.headers.get("authorization")).toBe("Bearer trusted-token");
    expect(await cleared?.json()).toEqual({ comment: "   ", reviewed: false });
  });

  it("counts a CRLF line break of the form as one character", async () => {
    backend.mockResolvedValueOnce(
      Response.json({ authorFeedback: null }, { status: 200 }),
    );
    const comment = `${"x".repeat(3_990)}${"\r\n".repeat(10)}`;
    const response = await handleSaveAuthorFeedback(
      feedback({ submissionId, comment, reviewed: true }),
    );
    expect(await response.json()).toEqual({
      kind: "saved",
      authorFeedback: null,
    });
    expect(
      await expectSingleBackendRequest(
        backend,
        "PUT",
        `/authoring/product-tasks/submissions/${submissionId}/feedback`,
      ).json(),
    ).toEqual({
      comment: `${"x".repeat(3_990)}${"\n".repeat(10)}`,
      reviewed: true,
    });
  });

  it("refuses a malformed save without calling the backend", async () => {
    for (const values of [
      { submissionId: "not-a-uuid", comment: "", reviewed: true },
      { submissionId, comment: "", reviewed: "yes" },
      { submissionId, comment: "x".repeat(4_001), reviewed: true },
    ]) {
      const response = await handleSaveAuthorFeedback(feedback(values));
      expect(await response.json()).toEqual({ kind: "invalid_input" });
    }
    expect(backend).not.toHaveBeenCalled();
  });

  it.each([
    [400, { kind: "invalid_input" }],
    [401, { kind: "unauthorized" }],
    [403, { kind: "forbidden" }],
    [404, { kind: "submission_not_found" }],
    [503, { kind: "unavailable" }],
  ])("maps backend status %i to a form outcome", async (status, outcome) => {
    backend.mockResolvedValueOnce(
      Response.json({ code: "x" }, { status: status }),
    );
    const response = await handleSaveAuthorFeedback(
      feedback({ submissionId, comment: "", reviewed: true }),
    );
    expect(await response.json()).toEqual(outcome);
  });
});

describe("submission filter (#948)", () => {
  const products: FilterProduct[] = [
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

  it("keeps a filter the Products on offer can show", () => {
    expect(
      consistentSelection(
        { productId: "g1", chapterId: "c2", taskCode: "t2" },
        products,
      ),
    ).toEqual({ productId: "g1", chapterId: "c2", taskCode: "t2" });
    expect(consistentSelection({ taskCode: "t3" }, products)).toEqual({
      taskCode: "t3",
    });
  });

  it("drops a chapter of another Product, a task of another chapter and unknown values", () => {
    expect(
      consistentSelection({ productId: "g1", chapterId: "c3" }, products),
    ).toEqual({ productId: "g1" });
    expect(
      consistentSelection(
        { productId: "g1", chapterId: "c1", taskCode: "t2" },
        products,
      ),
    ).toEqual({ productId: "g1", chapterId: "c1" });
    expect(consistentSelection({ chapterId: "c1" }, products)).toEqual({});
    expect(consistentSelection({ productId: "broken" }, products)).toEqual({});
  });

  it("builds the address of a filtered page", () => {
    expect(submissionsListHref({ selection: {}, feedback: "awaiting" })).toBe(
      "/authoring/submissions",
    );
    expect(
      submissionsListHref({
        selection: { productId: "g1", taskCode: "t1" },
        feedback: "awaiting",
        cursor: "next-page",
      }),
    ).toBe("/authoring/submissions?productId=g1&task=t1&cursor=next-page");
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
