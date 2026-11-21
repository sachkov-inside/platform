import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { lessonInteractions } from "../../../../scenarios/lesson-interactions.mjs";
import { realBffSession } from "../support/real-bff-session";
import { PUT as submitFeedback } from "../../app/api/lesson-ratings/feedback/route";
import { POST as readFeedback } from "../../app/api/lesson-ratings/feedback/query/route";
import {
  readLessonFeedbackOperation,
  submitLessonFeedbackOperation,
} from "@/features/lesson-rating/api/lesson-feedback.operation";
import { routeBrowserMutations } from "../support/mutation-operation-route";

const feedbackReplies = vi.fn<(request: Request) => Promise<Response>>();
const ratingReplies = vi.fn<(request: Request) => Promise<Response>>();
const statsReplies = vi.fn<(request: Request) => Promise<Response>>();
const countReplies = vi.fn<(request: Request) => Promise<Response>>();
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleLessonRating as realHandleLessonRating,
  handleSetLessonRating as realHandleSetLessonRating,
} from "@/features/lesson-rating.server";
import { handleLessonStatistics as realHandleLessonStatistics } from "@/features/lesson-statistics.server";

const handleLessonRating = (request: Request) =>
  session(() => realHandleLessonRating(request));
const handleSetLessonRating = (request: Request) =>
  session(() => realHandleSetLessonRating(request));
const handleLessonStatistics = (request: Request) =>
  session(() => realHandleLessonStatistics(request));
const materialId = lessonInteractions.materialId;

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

const ok = (body: unknown) => Response.json(body);
const failed = (status: number) => new Response(null, { status });

beforeEach(async () => {
  for (const reply of [
    backend,
    feedbackReplies,
    ratingReplies,
    statsReplies,
    countReplies,
  ])
    reply.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession();
  backend.mockImplementation((request) => {
    const url = new URL(request.url);
    if (url.origin !== "https://platform-api.example.test")
      throw new Error(`Unexpected origin ${url.origin}`);
    if (url.pathname === `/lesson-ratings/materials/${materialId}`)
      return ratingReplies(request);
    if (url.pathname === `/lesson-ratings/materials/${materialId}/feedback`)
      return feedbackReplies(request);
    if (
      url.pathname === `/authoring/materials/${materialId}/exercise-statistics`
    )
      return statsReplies(request);
    if (url.pathname === `/authoring/materials/${materialId}/ratings`)
      return countReplies(request);
    throw new Error(`Unexpected backend URL ${request.url}`);
  });
  vi.stubGlobal("fetch", backend);
});
afterEach(() => vi.useRealTimers());

it("rejects a cross-origin rating before authentication or backend calls", async () => {
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
  const response = await handleSetLessonRating(
    request(
      "/api/lesson-ratings/rating",
      { materialId, rating: "like" },
      "PUT",
      "https://outside.test",
    ),
  );
  expect(response.status).toBe(403);
  expect(tokenReads).not.toHaveBeenCalled();
  expect(ratingReplies).not.toHaveBeenCalled();
});

it("sets and removes the rating for the session's Account and drops a posted identity", async () => {
  ratingReplies.mockResolvedValueOnce(ok({ rating: "like" }));
  const liked = await handleSetLessonRating(
    request(
      "/api/lesson-ratings/rating",
      { materialId, rating: "like", accountId: "untrusted" },
      "PUT",
    ),
  );
  expect(
    await expectBackendRequest(
      "PUT",
      `/lesson-ratings/materials/${materialId}`,
    ).json(),
  ).toEqual({ rating: "like" });
  expect(await liked.json()).toEqual({ kind: "ready", rating: "like" });

  ratingReplies.mockResolvedValueOnce(ok({ rating: null }));
  const cleared = await handleSetLessonRating(
    request("/api/lesson-ratings/rating", { materialId, rating: null }, "PUT"),
  );
  expect(
    expectBackendRequest("DELETE", `/lesson-ratings/materials/${materialId}`)
      .body,
  ).toBeNull();
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
  expect(ratingReplies).not.toHaveBeenCalled();
});

it("maps backend refusals of a rating to rejected, sign-in and unavailable outcomes", async () => {
  for (const [status, kind] of [
    [403, "rejected"],
    [404, "rejected"],
    [401, "unauthorized"],
    [503, "unavailable"],
  ] as const) {
    ratingReplies.mockResolvedValueOnce(failed(status));
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
  ratingReplies.mockResolvedValueOnce(ok({ rating: "dislike" }));
  const response = await handleLessonRating(
    request("/api/lesson-ratings/query", { materialId }),
  );
  expectBackendRequest("GET", `/lesson-ratings/materials/${materialId}`);
  expect(await response.json()).toEqual({ kind: "ready", rating: "dislike" });
});

function connectFeedbackRoutes() {
  routeBrowserMutations(
    {
      "/api/lesson-ratings/feedback": { PUT: submitFeedback },
      "/api/lesson-ratings/feedback/query": { POST: readFeedback },
    },
    undefined,
    { run: session, externalFetch: backend },
  );
}

it("reads and submits feedback through the session and uses only the learner's review text", async () => {
  connectFeedbackRoutes();
  feedbackReplies.mockResolvedValueOnce(ok({ submitted: false }));
  await expect(
    readLessonFeedbackOperation.send({ materialId }),
  ).resolves.toEqual({
    kind: "ready",
    submitted: false,
  });
  expectBackendRequest(
    "GET",
    `/lesson-ratings/materials/${materialId}/feedback`,
  );
  feedbackReplies.mockResolvedValueOnce(ok({ submitted: true }));
  const input = {
    materialId,
    text: "  Больше примеров  ",
    accountId: "untrusted",
  };
  await expect(submitLessonFeedbackOperation.send(input)).resolves.toEqual({
    kind: "ready",
    submitted: true,
  });
  expect(
    await expectBackendRequest(
      "PUT",
      `/lesson-ratings/materials/${materialId}/feedback`,
    ).json(),
  ).toEqual({
    text: "Больше примеров",
  });
});

it("rejects a blank review before the backend and refuses a malformed receipt", async () => {
  connectFeedbackRoutes();
  await expect(
    submitLessonFeedbackOperation.send({ materialId, text: "  \n" }),
  ).resolves.toEqual({
    kind: "unavailable",
  });
  expect(feedbackReplies).not.toHaveBeenCalled();
  feedbackReplies.mockResolvedValueOnce(ok({ submitted: "true" }));
  await expect(
    submitLessonFeedbackOperation.send({ materialId, text: "Больше примеров" }),
  ).resolves.toEqual({
    kind: "unavailable",
  });
  feedbackReplies.mockResolvedValueOnce(failed(404));
  await expect(
    readLessonFeedbackOperation.send({ materialId }),
  ).resolves.toEqual({
    kind: "not_lesson",
  });
});

const statistics = { exercises: lessonInteractions.module.statistics };

it("joins exercise statistics and rating counts for an author", async () => {
  statsReplies.mockResolvedValueOnce(ok(statistics));
  countReplies.mockResolvedValueOnce(ok(lessonInteractions.module.ratings));
  const response = await handleLessonStatistics(
    request("/api/authoring/lesson-statistics", { materialId }),
  );
  expectBackendRequest(
    "GET",
    `/authoring/materials/${materialId}/exercise-statistics`,
  );
  expectBackendRequest("GET", `/authoring/materials/${materialId}/ratings`);
  expect(await response.json()).toEqual({
    kind: "ready",
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
    ratings: { likes: 3, dislikes: 1 },
  });
});

it("reports a refused author as forbidden and a failed owner as unavailable", async () => {
  statsReplies.mockResolvedValueOnce(failed(403));
  countReplies.mockResolvedValueOnce(failed(403));
  const forbidden = await handleLessonStatistics(
    request("/api/authoring/lesson-statistics", { materialId }),
  );
  expect(await forbidden.json()).toEqual({ kind: "forbidden" });

  statsReplies.mockResolvedValueOnce(ok(statistics));
  countReplies.mockResolvedValueOnce(failed(503));
  const unavailable = await handleLessonStatistics(
    request("/api/authoring/lesson-statistics", { materialId }),
  );
  expect(await unavailable.json()).toEqual({ kind: "unavailable" });
});

function expectBackendRequest(method: string, path: string): Request {
  const requests = backend.mock.calls
    .map(([request]) => request)
    .filter(
      (request) =>
        request.method === method &&
        request.url === `https://platform-api.example.test${path}`,
    );
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (request === undefined) throw new Error("Expected backend request");
  expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
  return request;
}
