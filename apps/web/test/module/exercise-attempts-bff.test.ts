import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  read: vi.fn(),
  record: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestExerciseAttempts: fakes.read,
  requestRecordExerciseAttempt: fakes.record,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: fakes.LogtoSessionUnavailableError,
}));

import {
  handleExerciseAttempts,
  handleRecordExerciseAttempt,
} from "@/features/exercise-attempts.server";

const materialId = "6d155605-f852-461a-bdeb-df68b0b441c4";
const attempt = {
  exerciseId: "rag-wrong-platform",
  fingerprint: "669258ca11c32c41",
  answer: { kind: "options", optionIds: ["prompt"] },
  result: "correct",
  firstForVersion: true,
  attemptedAt: "2026-11-13T09:00:00.000Z",
};

function request(
  path: string,
  values: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  return new Request(`https://inside.example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(values),
  });
}

const recordBody = {
  materialId,
  exerciseId: "rag-wrong-platform",
  answer: { kind: "options", optionIds: ["prompt"] },
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

it("rejects a cross-origin attempt before authentication or backend calls", async () => {
  const response = await handleRecordExerciseAttempt(
    request(
      "/api/exercise-attempts/attempt",
      recordBody,
      "https://outside.test",
    ),
  );
  expect(response.status).toBe(403);
  expect(fakes.token).not.toHaveBeenCalled();
  expect(fakes.record).not.toHaveBeenCalled();
});

it("records the answer for the session's Account and drops posted results and identities", async () => {
  fakes.record.mockResolvedValue({
    ok: true,
    body: attempt,
    response: new Response(),
  });
  const response = await handleRecordExerciseAttempt(
    request("/api/exercise-attempts/attempt", {
      ...recordBody,
      result: "correct",
      accountId: "untrusted",
    }),
  );
  expect(fakes.record).toHaveBeenCalledWith(recordBody, "trusted-token");
  expect(await response.json()).toEqual({ kind: "ready", attempt });
});

it("refuses an answer outside the shape without a backend call", async () => {
  for (const answer of [
    { kind: "options", optionIds: [] },
    { kind: "result", value: "correct" },
  ]) {
    const response = await handleRecordExerciseAttempt(
      request("/api/exercise-attempts/attempt", { ...recordBody, answer }),
    );
    expect(await response.json()).toEqual({ kind: "invalid_input" });
  }
  expect(fakes.record).not.toHaveBeenCalled();
});

it("maps backend refusals of an attempt to rejected, sign-in and unavailable outcomes", async () => {
  for (const [status, kind] of [
    [403, "rejected"],
    [404, "rejected"],
    [422, "rejected"],
    [401, "unauthorized"],
    [503, "unavailable"],
  ] as const) {
    fakes.record.mockResolvedValueOnce({
      ok: false,
      problem: null,
      response: new Response(null, { status }),
    });
    const response = await handleRecordExerciseAttempt(
      request("/api/exercise-attempts/attempt", recordBody),
    );
    expect(await response.json()).toEqual({ kind });
  }
});

it("reads the latest attempts of one Material and reports a failed backend as unavailable", async () => {
  fakes.read.mockResolvedValueOnce({
    ok: true,
    body: { items: [attempt] },
    response: new Response(),
  });
  const ready = await handleExerciseAttempts(
    request("/api/exercise-attempts/query", { materialId }),
  );
  expect(fakes.read).toHaveBeenCalledWith(materialId, "trusted-token");
  expect(await ready.json()).toEqual({ kind: "ready", attempts: [attempt] });

  fakes.read.mockResolvedValueOnce({
    ok: false,
    problem: null,
    response: new Response(null, { status: 503 }),
  });
  const failed = await handleExerciseAttempts(
    request("/api/exercise-attempts/query", { materialId }),
  );
  expect(await failed.json()).toEqual({ kind: "unavailable" });
});
