import type { UIMessage } from "ai";
import { z } from "zod";

const criterionStatusSchema = z.enum([
  "confirmed",
  "violation",
  "not_verified",
]);
export type CriterionStatus = z.infer<typeof criterionStatusSchema>;

const candidateSchema = z.object({
  id: z.string(),
  kind: z.enum(["default_branch", "pull_request"]),
  label: z.string(),
  ref: z.string(),
  commitSha: z.string(),
  url: z.url(),
});
export type ReviewCandidate = z.infer<typeof candidateSchema>;

export const reviewFailureCodeSchema = z.enum([
  "context_version_mismatch",
  "practice_unavailable",
  "repository_access_revoked",
  "repository_too_large",
  "invalid_report",
  "limit_exceeded",
  "model_unavailable",
  "dependency_unavailable",
  "interrupted",
]);
export type ReviewFailureCode = z.infer<typeof reviewFailureCodeSchema>;

export const practiceReviewSchema = z.object({
  id: z.uuid(),
  practiceId: z.string(),
  kind: z.enum(["initial", "recheck"]),
  state: z.enum([
    "queued",
    "awaiting_choice",
    "running",
    "completed",
    "failed",
  ]),
  contextVersion: z.string(),
  repository: z.object({ fullName: z.string(), htmlUrl: z.url() }),
  requestedAt: z.string(),
  completedAt: z.string().nullable(),
  candidates: z.array(candidateSchema).nullable(),
  checked: candidateSchema.nullable(),
  result: z
    .object({
      practiceStatus: z.enum(["accepted", "needs_work"]),
      summary: z.string(),
      criteria: z.array(
        z.object({
          criterionId: z.string(),
          status: criterionStatusSchema,
          evidence: z.array(
            z.object({
              path: z.string(),
              startLine: z.number().nullable(),
              endLine: z.number().nullable(),
              url: z.url(),
            }),
          ),
          explanation: z.string(),
          nextStep: z.string().nullable(),
          previousStatus: criterionStatusSchema.nullable(),
          changed: z.boolean(),
        }),
      ),
    })
    .nullable(),
  previousReviewId: z.string().nullable(),
  failure: z
    .object({
      code: reviewFailureCodeSchema,
      currentContextVersion: z.string().nullable(),
    })
    .nullable(),
});
export type PracticeReview = z.infer<typeof practiceReviewSchema>;

export const practiceStatusSchema = z.enum([
  "not_started",
  "in_review",
  "needs_work",
  "accepted",
]);
export type PracticeStatus = z.infer<typeof practiceStatusSchema>;

export const practiceConversationSchema = z.object({
  practice: z
    .object({
      practiceId: z.string(),
      title: z.string(),
      contextVersion: z.string(),
      criteria: z.array(z.object({ id: z.string(), requirement: z.string() })),
    })
    .nullable(),
  status: practiceStatusSchema,
  activeReview: practiceReviewSchema.nullable(),
  messages: z.array(
    z.object({
      id: z.uuid(),
      role: z.enum(["participant", "assistant"]),
      kind: z.enum(["text", "candidate_question", "review_result"]),
      text: z.string().nullable(),
      review: practiceReviewSchema.nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type PracticeConversation = z.infer<typeof practiceConversationSchema>;

/** Отказ поставить проверку: участник видит причину и следующий шаг в чате. */
export const reviewRefusalCodeSchema = z.enum([
  "data_notice_required",
  "repository_link_required",
  "repository_access_revoked",
  "practice_unavailable",
  "practice_context_version_mismatch",
  "review_not_awaiting_choice",
  "candidate_not_available",
  "review_unavailable",
  "unavailable",
]);
export type ReviewRefusalCode = z.infer<typeof reviewRefusalCodeSchema>;

/**
 * Часть сообщения помощника в потоке AI SDK UI. `progress` — проверка идёт, `choice` — вопрос о
 * варианте работы, `result` — итог или сбой. Одна проверка обновляет свою часть по её id.
 */
export const practiceReviewPartSchema = z.object({
  stage: z.enum(["progress", "choice", "result"]),
  review: practiceReviewSchema,
});
export type PracticeReviewPart = z.infer<typeof practiceReviewPartSchema>;

export const reviewRefusalPartSchema = z.object({
  code: reviewRefusalCodeSchema,
  currentContextVersion: z.string().nullable(),
});
export type ReviewRefusalPart = z.infer<typeof reviewRefusalPartSchema>;

export type PracticeReviewUIMessage = UIMessage<
  never,
  {
    "practice-review": PracticeReviewPart;
    "practice-review-refusal": ReviewRefusalPart;
  }
>;

export const practiceIdSchema = z.string().trim().min(1).max(200);
export const contextVersionSchema = z.hash("sha256");

/** «Проверить задание» или «Проверить снова» в чате практики. */
export const reviewCommandSchema = z.object({
  practiceId: practiceIdSchema,
  expectedContextVersion: contextVersionSchema,
  /** Не повторять выбор прошлой проверки: спросить, какую работу проверить. */
  chooseWork: z.boolean().optional(),
});
export type ReviewCommand = z.infer<typeof reviewCommandSchema>;

/** Выбор варианта работы в проверке, которая его ждёт. */
export const candidateCommandSchema = z.object({
  reviewId: z.uuid(),
  candidateId: z.string().min(1).max(100),
});
export type CandidateCommand = z.infer<typeof candidateCommandSchema>;

/** Действие участника в чате; каждое уходит своему адресу BFF. */
export const practiceReviewActionSchema = z.discriminatedUnion("kind", [
  reviewCommandSchema.extend({ kind: z.literal("review") }),
  candidateCommandSchema.extend({ kind: z.literal("choose") }),
]);
export type PracticeReviewAction = z.infer<typeof practiceReviewActionSchema>;

const activeStates = new Set<PracticeReview["state"]>([
  "queued",
  "running",
  "awaiting_choice",
]);

export function isReviewActive(review: PracticeReview): boolean {
  return activeStates.has(review.state);
}

/** Этап, которым часть показывает проверку сейчас. */
export function stageOf(review: PracticeReview): PracticeReviewPart["stage"] {
  if (review.state === "awaiting_choice") return "choice";
  return review.state === "completed" || review.state === "failed"
    ? "result"
    : "progress";
}

/**
 * Сохранённая беседа в сообщениях AI SDK UI. Идущая проверка без итога показывается последним
 * сообщением помощника с частью `progress`, чтобы чат продолжил следить за ней.
 */
export function toUIMessages(
  conversation: PracticeConversation,
): PracticeReviewUIMessage[] {
  const messages: PracticeReviewUIMessage[] = conversation.messages.flatMap(
    (message): PracticeReviewUIMessage[] => {
      if (message.kind === "text")
        return message.text === null
          ? []
          : [
              {
                id: message.id,
                role: message.role === "assistant" ? "assistant" : "user",
                parts: [{ type: "text", text: message.text }],
              },
            ];
      if (message.review === null) return [];
      return [
        {
          id: message.id,
          role: "assistant",
          parts: [
            {
              type: "data-practice-review",
              id: `${message.kind}:${message.review.id}`,
              data: {
                stage:
                  message.kind === "candidate_question" ? "choice" : "result",
                review: message.review,
              },
            },
          ],
        },
      ];
    },
  );
  const active = conversation.activeReview;
  if (active !== null && active.state !== "awaiting_choice")
    messages.push(progressMessage(active));
  return messages;
}

export function progressMessageId(reviewId: string): string {
  return `progress:${reviewId}`;
}

function progressMessage(review: PracticeReview): PracticeReviewUIMessage {
  return {
    id: progressMessageId(review.id),
    role: "assistant",
    parts: [
      {
        type: "data-practice-review",
        id: `live:${review.id}`,
        data: { stage: stageOf(review), review },
      },
    ],
  };
}

export const practiceStatusLabels: Readonly<Record<PracticeStatus, string>> = {
  not_started: "Не начато",
  in_review: "На проверке",
  needs_work: "Нужны доработки",
  accepted: "Принято",
};

export const criterionStatusLabels: Readonly<Record<CriterionStatus, string>> =
  {
    confirmed: "Подтверждён",
    violation: "Нарушен",
    not_verified: "Не удалось проверить",
  };

export const reviewFailureMessages: Readonly<
  Record<ReviewFailureCode, string>
> = {
  context_version_mismatch:
    "Задание изменилось после запроса. Проверка по старой версии не выполнялась; запустите её по новой версии.",
  practice_unavailable: "Задание сейчас недоступно вашему аккаунту.",
  repository_access_revoked:
    "Курс больше не может читать репозиторий: установка GitHub App удалена или репозиторий из неё убран. Подключите репозиторий заново.",
  repository_too_large:
    "Репозиторий слишком большой для проверки учебного проекта.",
  invalid_report:
    "Помощник не вернул итог по всем критериям. Статус задания не изменился; попробуйте ещё раз.",
  limit_exceeded:
    "Проверка не уложилась в лимит шагов, токенов или времени модели. Статус задания не изменился; попробуйте ещё раз.",
  model_unavailable:
    "Модель не ответила. Статус задания не изменился; попробуйте ещё раз чуть позже.",
  dependency_unavailable:
    "Проверка не завершилась из-за сбоя сервиса. Статус задания не изменился; попробуйте ещё раз.",
  interrupted:
    "Проверка прервалась. Статус задания не изменился; запустите её заново.",
};

export const reviewRefusalMessages: Readonly<
  Record<ReviewRefusalCode, string>
> = {
  data_notice_required:
    "Сначала прочитайте предупреждение о данных в разделе помощника.",
  repository_link_required:
    "Сначала подключите репозиторий учебного проекта в разделе помощника.",
  repository_access_revoked:
    "Курс больше не может читать подключённый репозиторий. Подключите его заново в разделе помощника.",
  practice_unavailable: "Задание сейчас недоступно вашему аккаунту.",
  practice_context_version_mismatch:
    "Задание изменилось с момента, когда вы открыли страницу. Проверьте работу по новой версии.",
  review_not_awaiting_choice: "Эта проверка уже не ждёт выбора.",
  candidate_not_available: "Этот вариант больше недоступен.",
  review_unavailable: "Проверка сейчас недоступна: модель не настроена.",
  unavailable: "Не получилось поставить проверку. Попробуйте ещё раз.",
};
