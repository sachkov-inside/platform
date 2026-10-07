import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  submit: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", async () => {
  const transport = await import("@/shared/api/backend/transport-core.server");
  return {
    BackendConnectionError: transport.BackendConnectionError,
    requestSubmitProductTaskForm: fakes.submit,
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
import { handleSubmitProductTask } from "@/features/product-task-submission.server";

const fields = {
  code: "aie-ch1-onboarding",
  taskVersion: "2",
  submissionKey: "key-1",
  note: "Сделал выдачу доступа.",
  repositoryUrl: "https://github.com/learner/devportal",
  reportText: "",
};

function submission(
  values: Record<string, string>,
  origin = "https://inside.example.test",
) {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return new Request(
    "https://inside.example.test/api/product-tasks/submissions",
    {
      method: "POST",
      headers: { origin },
      body,
    },
  );
}

function problem(status: number, body: Record<string, unknown>) {
  return { ok: false, problem: body, response: new Response(null, { status }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

it("refuses a cross-origin submission before the session or the backend", async () => {
  const response = await handleSubmitProductTask(
    submission(fields, "https://outside.test"),
  );
  expect(response.status).toBe(403);
  expect(fakes.token).not.toHaveBeenCalled();
  expect(fakes.submit).not.toHaveBeenCalled();
});

it("forwards the form with the trusted token, drops empty optional fields and never a branch or commit", async () => {
  fakes.submit.mockResolvedValue({
    ok: true,
    body: {
      submissionId: "30000000-0000-4000-8000-000000000001",
      code: fields.code,
      taskVersion: 2,
      source: "form",
      submittedAt: "2026-10-05T16:40:00.000Z",
    },
    response: new Response(),
  });
  const response = await handleSubmitProductTask(
    submission({ ...fields, branch: "main", commit: "4f2a9c1" }),
  );
  expect(fakes.submit).toHaveBeenCalledWith(
    fields.code,
    {
      taskVersion: 2,
      submissionKey: "key-1",
      note: fields.note,
      repositoryUrl: fields.repositoryUrl,
    },
    "trusted-token",
  );
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
  expect(fakes.submit).not.toHaveBeenCalled();
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
    fakes.submit.mockResolvedValue(problem(status, body));
    const response = await handleSubmitProductTask(submission(fields));
    expect(await response.json()).toEqual(outcome);
  },
);
