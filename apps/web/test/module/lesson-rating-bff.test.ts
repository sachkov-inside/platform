import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  read: vi.fn(),
  rate: vi.fn(),
  statistics: vi.fn(),
  counts: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestLessonRating: fakes.read,
  requestRateLesson: fakes.rate,
  requestExerciseStatistics: fakes.statistics,
  requestLessonRatingCounts: fakes.counts,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: fakes.LogtoSessionUnavailableError,
}));

import {
  handleLessonRating,
  handleSetLessonRating,
} from "@/features/lesson-rating.server";
import { handleLessonStatistics } from "@/features/lesson-statistics.server";

const materialId = "6d155605-f852-461a-bdeb-df68b0b441c4";

function request(
  path: string,
  values: Record<string, unknown>,
  method = "POST",
  origin = "https://inside.example.test",
) {
  return new Request(`https://inside.example.test${path}`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(values),
  });
}

const ok = (body: unknown) => ({ ok: true, body, response: new Response() });
const failed = (status: number) => ({
  ok: false,
  problem: null,
  response: new Response(null, { status }),
});

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

it("rejects a cross-origin rating before authentication or backend calls", async () => {
  const response = await handleSetLessonRating(
    request(
      "/api/lesson-ratings/rating",
      { materialId, rating: "like" },
      "PUT",
      "https://outside.test",
    ),
  );
  expect(response.status).toBe(403);
  expect(fakes.token).not.toHaveBeenCalled();
  expect(fakes.rate).not.toHaveBeenCalled();
});

it("sets and removes the rating for the session's Account and drops a posted identity", async () => {
  fakes.rate.mockResolvedValueOnce(ok({ rating: "like" }));
  const liked = await handleSetLessonRating(
    request(
      "/api/lesson-ratings/rating",
      { materialId, rating: "like", accountId: "untrusted" },
      "PUT",
    ),
  );
  expect(fakes.rate).toHaveBeenCalledWith(
    { materialId, rating: "like" },
    "trusted-token",
  );
  expect(await liked.json()).toEqual({ kind: "ready", rating: "like" });

  fakes.rate.mockResolvedValueOnce(ok({ rating: null }));
  const cleared = await handleSetLessonRating(
    request("/api/lesson-ratings/rating", { materialId, rating: null }, "PUT"),
  );
  expect(fakes.rate).toHaveBeenLastCalledWith(
    { materialId, rating: null },
    "trusted-token",
  );
  expect(await cleared.json()).toEqual({ kind: "ready", rating: null });
});

it("refuses a rating outside like and dislike without a backend call", async () => {
  const response = await handleSetLessonRating(
    request(
      "/api/lesson-ratings/rating",
      { materialId, rating: "love" },
      "PUT",
    ),
  );
  expect(await response.json()).toEqual({ kind: "invalid_input" });
  expect(fakes.rate).not.toHaveBeenCalled();
});

it("maps backend refusals of a rating to rejected, sign-in and unavailable outcomes", async () => {
  for (const [status, kind] of [
    [403, "rejected"],
    [404, "rejected"],
    [401, "unauthorized"],
    [503, "unavailable"],
  ] as const) {
    fakes.rate.mockResolvedValueOnce(failed(status));
    const response = await handleSetLessonRating(
      request(
        "/api/lesson-ratings/rating",
        { materialId, rating: "dislike" },
        "PUT",
      ),
    );
    expect(await response.json()).toEqual({ kind });
  }
});

it("reads the reader's own rating", async () => {
  fakes.read.mockResolvedValueOnce(ok({ rating: "dislike" }));
  const response = await handleLessonRating(
    request("/api/lesson-ratings/query", { materialId }),
  );
  expect(fakes.read).toHaveBeenCalledWith(materialId, "trusted-token");
  expect(await response.json()).toEqual({ kind: "ready", rating: "dislike" });
});

const statistics = {
  exercises: [
    {
      exerciseId: "rag-wrong-platform",
      kind: "quiz",
      versions: [
        {
          fingerprint: "669258ca11c32c41",
          firstAnsweredAt: "2026-11-13T09:00:00.000Z",
          respondents: 4,
          firstTryCorrect: 1,
          firstTryDontKnow: 1,
          mostFrequentMistake: {
            kind: "options",
            optionIds: ["embed"],
            count: 2,
          },
        },
      ],
    },
  ],
};

it("joins exercise statistics and rating counts for an author", async () => {
  fakes.statistics.mockResolvedValueOnce(ok(statistics));
  fakes.counts.mockResolvedValueOnce(ok({ likes: 3, dislikes: 1 }));
  const response = await handleLessonStatistics(
    request("/api/authoring/lesson-statistics", { materialId }),
  );
  expect(fakes.statistics).toHaveBeenCalledWith(materialId, "trusted-token");
  expect(fakes.counts).toHaveBeenCalledWith(materialId, "trusted-token");
  expect(await response.json()).toEqual({
    kind: "ready",
    exercises: statistics.exercises,
    ratings: { likes: 3, dislikes: 1 },
  });
});

it("reports a refused author as forbidden and a failed owner as unavailable", async () => {
  fakes.statistics.mockResolvedValueOnce(failed(403));
  fakes.counts.mockResolvedValueOnce(failed(403));
  const forbidden = await handleLessonStatistics(
    request("/api/authoring/lesson-statistics", { materialId }),
  );
  expect(await forbidden.json()).toEqual({ kind: "forbidden" });

  fakes.statistics.mockResolvedValueOnce(ok(statistics));
  fakes.counts.mockResolvedValueOnce(failed(503));
  const unavailable = await handleLessonStatistics(
    request("/api/authoring/lesson-statistics", { materialId }),
  );
  expect(await unavailable.json()).toEqual({ kind: "unavailable" });
});
