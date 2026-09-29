import { DefaultChatTransport, readUIMessageStream } from "ai";
import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  request: vi.fn(),
  read: vi.fn(),
  choose: vi.fn(),
  conversation: vi.fn(),
  SessionUnavailable: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestCourseAssistantPracticeReview: fakes.request,
  requestReadCourseAssistantPracticeReview: fakes.read,
  requestChooseCourseAssistantReviewCandidate: fakes.choose,
  requestCourseAssistantPracticeConversation: fakes.conversation,
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.token,
  LogtoSessionUnavailableError: fakes.SessionUnavailable,
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));
vi.mock("node:timers/promises", () => ({
  setTimeout: () => Promise.resolve(),
}));
import {
  handlePracticeReviewChat,
  handlePracticeReviewResume,
  handleRequestPracticeReview,
} from "@/features/practice-review.server";
import {
  toUIMessages,
  type PracticeConversation,
  type PracticeReviewUIMessage,
} from "@/features/practice-review";

const practiceId = "synthetic:practice-brief";
const contextVersion = "c".repeat(64);
const review = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  practiceId,
  kind: "initial",
  state: "queued",
  contextVersion,
  repository: {
    fullName: "learner/agent-course",
    htmlUrl: "https://github.com/learner/agent-course",
  },
  requestedAt: "2026-09-29T09:00:00.000Z",
  completedAt: null,
  candidates: null,
  checked: null,
  result: null,
  previousReviewId: null,
  failure: null,
} as const;
const completed = {
  ...review,
  state: "completed",
  completedAt: "2026-09-29T09:01:00.000Z",
  checked: {
    id: "default_branch",
    kind: "default_branch",
    label: "основная ветка main",
    ref: "main",
    commitSha: "1".repeat(40),
    url: `https://github.com/learner/agent-course/tree/${"1".repeat(40)}`,
  },
  result: {
    practiceStatus: "accepted",
    summary: "Все критерии подтверждены.",
    criteria: [],
  },
} as const;

function ok(body: unknown, status = 200) {
  return { ok: true, body, response: new Response(null, { status }) };
}

function chatRequest(body: unknown) {
  return new Request(
    "https://inside.example.test/api/account/course-assistant/practice-chat",
    {
      method: "POST",
      headers: {
        origin: "https://inside.example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

/** Разбор потока тем же клиентом AI SDK, что и в браузере. */
async function finalMessage(
  response: Response,
): Promise<PracticeReviewUIMessage> {
  expect(response.headers.get("cache-control")).toContain("no-store");
  const transport = new DefaultChatTransport<PracticeReviewUIMessage>({
    api: "https://inside.example.test/stream",
    fetch: () => Promise.resolve(response),
  });
  const chunks = await transport.sendMessages({
    chatId: "practice",
    messages: [],
    trigger: "submit-message",
    messageId: undefined,
    abortSignal: undefined,
  });
  let last: PracticeReviewUIMessage | undefined;
  for await (const message of readUIMessageStream<PracticeReviewUIMessage>({
    stream: chunks,
  }))
    last = message;
  if (last === undefined) throw new Error("No message");
  return last;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

it("ставит проверку и ведёт поток до итога одной частью сообщения", async () => {
  fakes.request.mockResolvedValue(ok(review, 202));
  fakes.read
    .mockResolvedValueOnce(ok({ ...review, state: "running" }))
    .mockResolvedValueOnce(ok(completed));

  const message = await finalMessage(
    await handlePracticeReviewChat(
      chatRequest({
        practiceId,
        action: { kind: "review", expectedContextVersion: contextVersion },
      }),
    ),
  );

  expect(fakes.request).toHaveBeenCalledWith(
    practiceId,
    { expectedContextVersion: contextVersion },
    "trusted-token",
  );
  expect(message.parts).toEqual([
    {
      type: "data-practice-review",
      id: `live:${review.id}`,
      data: { stage: "result", review: completed },
    },
  ]);
});

it("останавливает поток на вопросе о варианте работы", async () => {
  fakes.request.mockResolvedValue(ok(review, 202));
  fakes.read.mockResolvedValueOnce(
    ok({
      ...review,
      state: "awaiting_choice",
      candidates: [completed.checked],
    }),
  );
  const message = await finalMessage(
    await handlePracticeReviewChat(
      chatRequest({
        practiceId,
        action: { kind: "review", expectedContextVersion: contextVersion },
      }),
    ),
  );
  expect(message.parts[0]).toMatchObject({ data: { stage: "choice" } });
  expect(fakes.read).toHaveBeenCalledTimes(1);
});

it("передаёт выбор варианта и объясняет отказ частью отказа", async () => {
  fakes.choose.mockResolvedValue({
    ok: false,
    problem: { code: "review_not_awaiting_choice" },
    response: new Response(null, { status: 409 }),
  });
  const refused = await finalMessage(
    await handlePracticeReviewChat(
      chatRequest({
        practiceId,
        action: {
          kind: "choose",
          reviewId: review.id,
          candidateId: "pull_request:3",
        },
      }),
    ),
  );
  expect(fakes.choose).toHaveBeenCalledWith(
    review.id,
    "pull_request:3",
    "trusted-token",
  );
  expect(refused.parts).toEqual([
    {
      type: "data-practice-review-refusal",
      id: "refusal",
      data: { code: "review_not_awaiting_choice", currentContextVersion: null },
    },
  ]);

  fakes.request.mockResolvedValue({
    ok: false,
    problem: {
      code: "practice_context_version_mismatch",
      currentContextVersion: "e".repeat(64),
    },
    response: new Response(null, { status: 409 }),
  });
  const stale = await finalMessage(
    await handlePracticeReviewChat(
      chatRequest({
        practiceId,
        action: { kind: "review", expectedContextVersion: contextVersion },
      }),
    ),
  );
  expect(stale.parts[0]).toMatchObject({
    data: {
      code: "practice_context_version_mismatch",
      currentContextVersion: "e".repeat(64),
    },
  });
});

it("отклоняет чужой origin и тело без действия", async () => {
  const foreign = await handlePracticeReviewChat(
    new Request(
      "https://inside.example.test/api/account/course-assistant/practice-chat",
      {
        method: "POST",
        headers: { origin: "https://evil.example.test" },
        body: "{}",
      },
    ),
  );
  expect(foreign.status).toBe(403);
  expect(
    (await handlePracticeReviewChat(chatRequest({ practiceId }))).status,
  ).toBe(400);
  expect(fakes.request).not.toHaveBeenCalled();
});

it("возобновляет поток идущей проверки и отвечает 204, когда ничего не идёт", async () => {
  const conversation = (activeReview: unknown) =>
    ok({
      practice: { practiceId, title: "Бриф", contextVersion, criteria: [] },
      status: "in_review",
      activeReview,
      messages: [],
    });
  fakes.conversation.mockResolvedValueOnce(conversation(null));
  const idle = await handlePracticeReviewResume(
    new Request(
      `https://inside.example.test/api/account/course-assistant/practice-chat?practiceId=${encodeURIComponent(practiceId)}`,
    ),
  );
  expect(idle.status).toBe(204);

  fakes.conversation.mockResolvedValueOnce(
    conversation({ ...review, state: "running" }),
  );
  fakes.read.mockResolvedValueOnce(ok(completed));
  const resumed = await finalMessage(
    await handlePracticeReviewResume(
      new Request(
        `https://inside.example.test/api/account/course-assistant/practice-chat?practiceId=${encodeURIComponent(practiceId)}`,
      ),
    ),
  );
  expect(resumed.parts[0]).toMatchObject({ data: { stage: "result" } });
});

it("ставит проверку со страницы урока и называет проверку для перехода", async () => {
  fakes.request.mockResolvedValue(ok(review, 202));
  const form = new FormData();
  form.set("practiceId", practiceId);
  form.set("expectedContextVersion", contextVersion);
  const response = await handleRequestPracticeReview(
    new Request(
      "https://inside.example.test/api/account/course-assistant/practice-reviews",
      {
        method: "POST",
        headers: { origin: "https://inside.example.test" },
        body: form,
      },
    ),
  );
  expect(await response.json()).toEqual({ ok: true, reviewId: review.id });
});

it("показывает сохранённую беседу и идущую проверку сообщениями чата", () => {
  const conversation: PracticeConversation = {
    practice: { practiceId, title: "Бриф", contextVersion, criteria: [] },
    status: "in_review",
    activeReview: { ...review, state: "running" },
    messages: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        role: "participant",
        kind: "text",
        text: "Проверить задание",
        review: null,
        createdAt: "2026-09-29T09:00:00.000Z",
      },
    ],
  };
  expect(toUIMessages(conversation)).toEqual([
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      role: "user",
      parts: [{ type: "text", text: "Проверить задание" }],
    },
    {
      id: `progress:${review.id}`,
      role: "assistant",
      parts: [
        {
          type: "data-practice-review",
          id: `live:${review.id}`,
          data: { stage: "progress", review: { ...review, state: "running" } },
        },
      ],
    },
  ]);
});
