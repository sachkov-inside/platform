import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let scope: Awaited<ReturnType<typeof realBffSession>>;
import { handleSubmitProductTask as realHandleSubmitProductTask } from "@/features/product-task-submission.server";

const handleSubmitProductTask = (request: Request) =>
  scope(() => realHandleSubmitProductTask(request));

const fields = {
  code: "aie-ch1-onboarding",
  taskVersion: 2,
  submissionKey: "key-1",
  note: "Сделал выдачу доступа.",
  repositoryUrl: "https://github.com/learner/devportal",
  reportText: "",
};

function submission(
  values: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  const body = JSON.stringify(values);
  return new Request(
    "https://inside.example.test/api/product-tasks/submissions",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body,
    },
  );
}

function problem(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession();
  interceptBackendHttp(backend);
});
afterEach(() => vi.useRealTimers());

it("refuses a cross-origin submission before the session or the backend", async () => {
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
  const response = await handleSubmitProductTask(
    submission(fields, "https://outside.test"),
  );
  expect(response.status).toBe(403);
  expect(tokenReads).not.toHaveBeenCalled();
  expect(backend).not.toHaveBeenCalled();
});

it("forwards the form with the trusted token, drops empty optional fields and never a branch or commit", async () => {
  backend.mockResolvedValueOnce(
    Response.json(
      {
        submissionId: "30000000-0000-4000-8000-000000000001",
        code: fields.code,
        taskVersion: 2,
        source: "form",
        submittedAt: "2026-10-05T16:40:00.000Z",
      },
      { status: 200 },
    ),
  );
  const response = await handleSubmitProductTask(
    submission({ ...fields, branch: "main", commit: "4f2a9c1" }),
  );
  expect(
    await expectSingleBackendRequest(
      backend,
      "POST",
      "/accounts/current/product-tasks/aie-ch1-onboarding/submissions",
    ).json(),
  ).toEqual({
    taskVersion: 2,
    submissionKey: "key-1",
    note: "Сделал выдачу доступа.",
    repositoryUrl: "https://github.com/learner/devportal",
  });
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(await response.json()).toEqual({
    kind: "submitted",
    submittedAt: "2026-10-05T16:40:00.000Z",
  });
});

it("refuses an empty note or a repository that is not an address without calling the backend", async () => {
  for (const values of [
    { ...fields, note: "   " },
    { ...fields, repositoryUrl: "javascript:alert(1)" },
  ]) {
    const response = await handleSubmitProductTask(submission(values));
    expect(await response.json()).toEqual({ kind: "invalid_input" });
  }
  expect(backend).not.toHaveBeenCalled();
});

it.each([
  [403, { code: "submissions_disabled" }, { kind: "submissions_closed" }],
  [404, { code: "task_not_available" }, { kind: "task_not_available" }],
  [
    409,
    { code: "task_version_changed", submittedVersion: 2, currentVersion: 3 },
    { kind: "version_changed", currentVersion: 3 },
  ],
  [409, { code: "idempotency_conflict" }, { kind: "unavailable" }],
  [429, { code: "submission_rate_limited" }, { kind: "rate_limited" }],
  [503, { code: "dependency_unavailable" }, { kind: "unavailable" }],
])(
  "maps backend status %i to a form outcome",
  async (status, body, outcome) => {
    backend.mockResolvedValue(problem(status, body));
    const response = await handleSubmitProductTask(submission(fields));
    expect(await response.json()).toEqual(outcome);
  },
);
