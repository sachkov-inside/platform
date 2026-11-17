import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleExerciseAttempts as realHandleExerciseAttempts,
  handleRecordExerciseAttempt as realHandleRecordExerciseAttempt,
} from "@/features/exercise-attempts.server";

const handleExerciseAttempts = (request: Request) =>
  session(() => realHandleExerciseAttempts(request));
const handleRecordExerciseAttempt = (request: Request) =>
  session(() => realHandleRecordExerciseAttempt(request));

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

beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession();
  vi.stubGlobal("fetch", backend);
});

afterEach(() => vi.useRealTimers());

it("rejects a cross-origin attempt before authentication or backend calls", async () => {
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
  const response = await handleRecordExerciseAttempt(
    request(
      "/api/exercise-attempts/attempt",
      recordBody,
      "https://outside.test",
    ),
  );
  expect(response.status).toBe(403);
  expect(tokenReads).not.toHaveBeenCalled();
  expect(backend).not.toHaveBeenCalled();
});

it("records the answer for the session's Account and drops posted results and identities", async () => {
  backend.mockResolvedValueOnce(Response.json(attempt));
  const response = await handleRecordExerciseAttempt(
    request("/api/exercise-attempts/attempt", {
      ...recordBody,
      result: "correct",
      accountId: "untrusted",
    }),
  );
  expect(
    await expectBackendRequest(
      "POST",
      `/exercise-attempts/materials/${materialId}/exercises/rag-wrong-platform`,
    ).json(),
  ).toEqual({ answer: { kind: "options", optionIds: ["prompt"] } });
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
  expect(backend).not.toHaveBeenCalled();
});

it("maps backend refusals of an attempt to rejected, sign-in and unavailable outcomes", async () => {
  for (const [status, kind] of [
    [403, "rejected"],
    [404, "rejected"],
    [422, "rejected"],
    [401, "unauthorized"],
    [503, "unavailable"],
  ] as const) {
    backend.mockResolvedValueOnce(new Response(null, { status }));
    const response = await handleRecordExerciseAttempt(
      request("/api/exercise-attempts/attempt", recordBody),
    );
    expect(await response.json()).toEqual({ kind });
  }
});

it("reads the latest attempts of one Material and reports a failed backend as unavailable", async () => {
  backend.mockResolvedValueOnce(Response.json({ items: [attempt] }));
  const ready = await handleExerciseAttempts(
    request("/api/exercise-attempts/query", { materialId }),
  );
  expectBackendRequest("GET", `/exercise-attempts/materials/${materialId}`);
  expect(await ready.json()).toEqual({ kind: "ready", attempts: [attempt] });

  backend.mockResolvedValueOnce(new Response(null, { status: 503 }));
  const failed = await handleExerciseAttempts(
    request("/api/exercise-attempts/query", { materialId }),
  );
  expect(await failed.json()).toEqual({ kind: "unavailable" });
});

function expectBackendRequest(method: string, path: string): Request {
  expect(backend).toHaveBeenCalledOnce();
  const request = backend.mock.calls[0]?.[0];
  if (request === undefined) throw new Error("Expected backend request");
  expect(request.method).toBe(method);
  expect(request.url).toBe(`https://platform-api.example.test${path}`);
  expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
  return request;
}
