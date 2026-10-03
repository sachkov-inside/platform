import "server-only";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from "ai";
import { z } from "zod";

import {
  requestChooseCourseAssistantReviewCandidate,
  requestCourseAssistantPracticeConversation,
  requestCourseAssistantPracticeReview,
  requestReadCourseAssistantPracticeReview,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  handleAuthenticatedMutation,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import {
  isReviewActive,
  candidateCommandSchema,
  contextVersionSchema,
  practiceConversationSchema,
  practiceIdSchema,
  practiceReviewSchema,
  reviewCommandSchema,
  reviewRefusalCodeSchema,
  stageOf,
  type PracticeConversation,
  type PracticeReview,
  type CandidateCommand,
  type ReviewCommand,
  type PracticeReviewUIMessage,
  type ReviewRefusalCode,
} from "../model/practice-review";

const chatRequestByteLimit = 16 * 1024;
/** Как часто поток перечитывает проверку, пока её выполняет worker. */
const reviewPollIntervalMilliseconds = 1_000;
/** Дольше поток не держится: чат переподключается к той же проверке после перезагрузки. */
const reviewFollowLimitMilliseconds = 10 * 60 * 1000;
const privateHeaders = { "cache-control": "private, no-store" };

export type PracticeConversationLoad =
  | { readonly kind: "ready"; readonly conversation: PracticeConversation }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" };

/** Беседа практики для серверной отрисовки; закрытый помощник и чужое задание — `unavailable`. */
export async function loadPracticeConversation(
  practiceId: string,
  accessToken: string,
): Promise<PracticeConversationLoad> {
  try {
    const result = await requestCourseAssistantPracticeConversation(
      practiceId,
      accessToken,
    );
    if (!result.ok)
      return result.response.status === 404
        ? { kind: "unavailable" }
        : { kind: "failed" };
    const parsed = practiceConversationSchema.safeParse(result.body);
    return parsed.success
      ? { kind: "ready", conversation: parsed.data }
      : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * «Проверить задание» или «Проверить снова» в чате практики (#788). Ответ — поток AI SDK UI,
 * который следит за проверкой, пока её выполняет worker, и заканчивается вопросом о варианте
 * работы или итогом.
 */
export function handlePracticeReviewChat(request: Request): Promise<Response> {
  return handleStreamingCommand(request, reviewCommandSchema, requestReview);
}

/** Выбор варианта работы в чате практики; ответ — такой же поток проверки. */
export function handleReviewCandidateChat(request: Request): Promise<Response> {
  return handleStreamingCommand(
    request,
    candidateCommandSchema,
    chooseCandidate,
  );
}

function handleStreamingCommand<Command>(
  request: Request,
  schema: z.ZodType<Command>,
  start: (command: Command, accessToken: string) => Promise<ActionOutcome>,
): Promise<Response> {
  return handleAuthenticatedMutation(
    request,
    async (body, accessToken) => {
      const command = schema.safeParse(
        parseJson(await new Response(body).text()),
      );
      if (!command.success)
        return new Response(null, { headers: privateHeaders, status: 400 });
      return reviewStream(
        await start(command.data, accessToken),
        accessToken,
        request.signal,
      );
    },
    {
      mode: "stream",
      maxBytes: chatRequestByteLimit,
      failureResponse: (failure) =>
        new Response(null, {
          headers: privateHeaders,
          status:
            failure === "authentication_required"
              ? 401
              : failure === "cross_origin_request"
                ? 403
                : failure === "body_too_large"
                  ? 413
                  : 503,
        }),
    },
  );
}

/**
 * «Проверить задание» со страницы урока: ставит проверку и отвечает, куда перейти. Сам ход
 * проверки участник видит уже в чате практики.
 */
export function handleRequestPracticeReview(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, async (form, accessToken) => {
    const command = reviewCommandSchema.safeParse({
      practiceId: form.get("practiceId"),
      expectedContextVersion: form.get("expectedContextVersion"),
    });
    if (!command.success) return { ok: false, code: "unavailable" };
    const started = await requestReview(command.data, accessToken);
    return started.ok
      ? { ok: true, reviewId: started.review.id }
      : { ok: false, code: started.code };
  });
}

/**
 * Возобновление чата после перезагрузки: поток идущей проверки этой практики или 204, если
 * ничего не идёт.
 */
export async function handlePracticeReviewResume(
  request: Request,
): Promise<Response> {
  const practiceId = practiceIdSchema.safeParse(
    new URL(request.url).searchParams.get("practiceId"),
  );
  if (!practiceId.success)
    return new Response(null, { headers: privateHeaders, status: 400 });
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    return new Response(null, {
      headers: privateHeaders,
      status: error instanceof LogtoSessionUnavailableError ? 401 : 503,
    });
  }
  const load = await loadPracticeConversation(practiceId.data, accessToken);
  if (load.kind === "unavailable")
    return new Response(null, { headers: privateHeaders, status: 404 });
  if (load.kind === "failed")
    return new Response(null, { headers: privateHeaders, status: 503 });
  const active = load.conversation.activeReview;
  if (active?.state !== "queued" && active?.state !== "running")
    return new Response(null, { headers: privateHeaders, status: 204 });
  return reviewStream(
    { ok: true, review: active },
    accessToken,
    request.signal,
  );
}

type ActionOutcome =
  | { readonly ok: true; readonly review: PracticeReview }
  | {
      readonly ok: false;
      readonly code: ReviewRefusalCode;
      readonly currentContextVersion: string | null;
    };

async function requestReview(
  command: ReviewCommand,
  accessToken: string,
): Promise<ActionOutcome> {
  try {
    return reviewOutcome(
      await requestCourseAssistantPracticeReview(
        command.practiceId,
        {
          expectedContextVersion: command.expectedContextVersion,
          ...(command.chooseWork === true ? { chooseWork: true } : {}),
        },
        accessToken,
      ),
    );
  } catch {
    return { ok: false, code: "unavailable", currentContextVersion: null };
  }
}

async function chooseCandidate(
  command: CandidateCommand,
  accessToken: string,
): Promise<ActionOutcome> {
  try {
    return reviewOutcome(
      await requestChooseCourseAssistantReviewCandidate(
        command.reviewId,
        command.candidateId,
        accessToken,
      ),
    );
  } catch {
    return { ok: false, code: "unavailable", currentContextVersion: null };
  }
}

function reviewOutcome(result: BackendTransportResult): ActionOutcome {
  if (!result.ok) return refusal(result);
  const review = practiceReviewSchema.safeParse(result.body);
  return review.success
    ? { ok: true, review: review.data }
    : { ok: false, code: "unavailable", currentContextVersion: null };
}

function refusal(
  result: Extract<BackendTransportResult, { ok: false }>,
): Extract<ActionOutcome, { ok: false }> {
  const problem = z
    .object({
      code: z.string(),
      currentContextVersion: contextVersionSchema.optional(),
    })
    .safeParse(result.problem);
  if (!problem.success)
    return { ok: false, code: "unavailable", currentContextVersion: null };
  const code =
    problem.data.code === "course_assistant_unavailable"
      ? "unavailable"
      : problem.data.code;
  const known = reviewRefusalCodeSchema.safeParse(code);
  return {
    ok: false,
    code: known.success ? known.data : "unavailable",
    currentContextVersion: problem.data.currentContextVersion ?? null,
  };
}

/**
 * Одно сообщение помощника, чья часть обновляется по ходу проверки. Поток следит за проверкой,
 * пока браузер его читает: закрытая страница останавливает опрос backend.
 */
function reviewStream(
  started: ActionOutcome,
  accessToken: string,
  signal: AbortSignal,
): Response {
  const stream = createUIMessageStream<PracticeReviewUIMessage>({
    async execute({ writer }) {
      writer.write({ type: "start", messageId: randomUUID() });
      if (!started.ok) {
        writer.write({
          type: "data-practice-review-refusal",
          id: "refusal",
          data: {
            code: started.code,
            currentContextVersion: started.currentContextVersion,
          },
        });
        writer.write({ type: "finish" });
        return;
      }
      await followReview(writer, started.review, accessToken, signal);
      writer.write({ type: "finish" });
    },
    onError: () => "Проверку не удалось показать. Обновите страницу.",
  });
  return createUIMessageStreamResponse({ stream, headers: privateHeaders });
}

async function followReview(
  writer: UIMessageStreamWriter<PracticeReviewUIMessage>,
  initial: PracticeReview,
  accessToken: string,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + reviewFollowLimitMilliseconds;
  let review = initial;
  let shown = "";
  for (;;) {
    const snapshot = JSON.stringify(review);
    if (snapshot !== shown) {
      writer.write({
        type: "data-practice-review",
        id: `live:${review.id}`,
        data: { stage: stageOf(review), review },
      });
      shown = snapshot;
    }
    if (
      !isReviewActive(review) ||
      review.state === "awaiting_choice" ||
      Date.now() > deadline
    )
      return;
    // Закрытый поток прерывает ожидание; его отказ здесь и означает конец опроса.
    await sleep(reviewPollIntervalMilliseconds, undefined, { signal }).catch(
      () => undefined,
    );
    if (signal.aborted) return;
    const next = await readReview(review.id, accessToken);
    if (next !== undefined) review = next;
  }
}

async function readReview(
  reviewId: string,
  accessToken: string,
): Promise<PracticeReview | undefined> {
  try {
    const result = await requestReadCourseAssistantPracticeReview(
      reviewId,
      accessToken,
    );
    if (!result.ok) return undefined;
    const parsed = practiceReviewSchema.safeParse(result.body);
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Кратковременный сбой чтения: поток спросит ещё раз на следующем шаге.
    return undefined;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Не JSON — такое тело схема запроса отклонит.
    return undefined;
  }
}
