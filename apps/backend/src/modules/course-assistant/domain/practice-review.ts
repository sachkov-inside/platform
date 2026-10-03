import { z } from "zod";

/**
 * Practice Review (#788): одна серверная проверка практики. Итог по каждому критерию приходит от
 * модели только структурированным ответом по этой схеме; Practice Status из него вычисляет сервер.
 */
export const criterionStatuses = [
  "confirmed",
  "violation",
  "not_verified",
] as const;
export type CriterionStatus = (typeof criterionStatuses)[number];

export type PracticeStatus =
  "not_started" | "in_review" | "needs_work" | "accepted";

/** Путь внутри снимка репозитория: относительный, без выхода наружу. */
export const repositoryPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.includes("\0") &&
      path.split("/").every((segment) => segment !== ".."),
    "Path must stay inside the repository",
  );

const evidenceSchema = z
  .strictObject({
    path: repositoryPathSchema,
    startLine: z.number().int().min(1).max(1_000_000).nullable(),
    endLine: z.number().int().min(1).max(1_000_000).nullable(),
  })
  .refine(
    ({ startLine, endLine }) =>
      startLine === null || endLine === null || startLine <= endLine,
    "Line range is inverted",
  );

const criterionVerdictSchema = z
  .strictObject({
    criterionId: z.string().min(1).max(100),
    status: z.enum(criterionStatuses),
    evidence: z.array(evidenceSchema).max(20),
    explanation: z.string().trim().min(1).max(4_000),
    nextStep: z.string().trim().min(1).max(2_000).nullable(),
  })
  .refine(
    ({ status, nextStep }) => status === "confirmed" || nextStep !== null,
    "violation and not_verified need a next step",
  );

/** Форма отчёта без сверки с критериями: так отчёт читается из базы после проверки. */
export const storedPracticeReviewReportSchema = z.strictObject({
  summary: z.string().trim().min(1).max(2_000),
  criteria: z.array(criterionVerdictSchema).max(50),
});

export type PracticeReviewReport = z.infer<
  typeof storedPracticeReviewReportSchema
>;

/**
 * Схема итога для заданных критериев: ровно один вердикт на каждый критерий задания. `confirmed`
 * требует хотя бы одного свидетельства — файла проверяемого коммита: подтверждение без
 * проверяемой опоры не принимается, даже если модель уговорил текст репозитория.
 */
export function practiceReviewReportSchema(
  criterionIds: readonly string[],
  snapshot: { readonly hasFile: (path: string) => boolean },
): z.ZodType<PracticeReviewReport> {
  return storedPracticeReviewReportSchema.superRefine((report, context) => {
    for (const [index, verdict] of report.criteria.entries())
      if (
        verdict.status === "confirmed" &&
        !verdict.evidence.some(({ path }) => snapshot.hasFile(path))
      )
        context.addIssue({
          code: "custom",
          path: ["criteria", index, "evidence"],
          message:
            "A confirmed verdict needs evidence: the path of a file in the reviewed commit",
        });
    const reported = report.criteria.map(({ criterionId }) => criterionId);
    const expected = new Set(criterionIds);
    if (
      reported.length !== expected.size ||
      new Set(reported).size !== reported.length ||
      reported.some((criterionId) => !expected.has(criterionId))
    )
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: `Report exactly one verdict for each criterion: ${criterionIds.join(", ")}`,
      });
  });
}

/** `accepted`, только если подтверждён каждый критерий; все критерии задания обязательны. */
export function practiceStatusOf(
  report: PracticeReviewReport,
): "accepted" | "needs_work" {
  return report.criteria.every(({ status }) => status === "confirmed")
    ? "accepted"
    : "needs_work";
}

export interface CriterionChange {
  readonly criterionId: string;
  readonly previousStatus: CriterionStatus | null;
  readonly changed: boolean;
}

/** Что изменилось по каждому критерию текущей проверки относительно прошлой Practice Review. */
export function compareWithPreviousReview(
  previous: PracticeReviewReport,
  current: PracticeReviewReport,
): readonly CriterionChange[] {
  const earlier = new Map(
    previous.criteria.map(({ criterionId, status }) => [criterionId, status]),
  );
  return current.criteria.map(({ criterionId, status }) => {
    const previousStatus = earlier.get(criterionId) ?? null;
    return { criterionId, previousStatus, changed: previousStatus !== status };
  });
}

export const reviewStates = [
  "queued",
  "awaiting_choice",
  "running",
  "completed",
  "failed",
] as const;
export type ReviewState = (typeof reviewStates)[number];
export const activeReviewStates = [
  "queued",
  "awaiting_choice",
  "running",
] as const satisfies readonly ReviewState[];

export function isActiveReviewState(state: ReviewState): boolean {
  return (activeReviewStates as readonly ReviewState[]).includes(state);
}

const reviewKindSchema = z.enum(["initial", "recheck"]);

/** Вид проверки из базы: первая или повторная; другое значение — ошибка данных. */
export function reviewKindOf(kind: string): "initial" | "recheck" {
  return reviewKindSchema.parse(kind);
}

/**
 * Practice Status Account по заданию из его проверок, от новой к старой: идущая проверка —
 * `in_review`, иначе итог последней завершённой. Сбой проверки статус не меняет (#788; отложенную
 * проверку добавляет #789).
 */
export function practiceStatusOfReviews(
  reviews: readonly {
    readonly state: ReviewState;
    readonly practiceStatus: "accepted" | "needs_work" | null;
  }[],
): PracticeStatus {
  const [latest] = reviews;
  if (latest === undefined) return "not_started";
  if (isActiveReviewState(latest.state)) return "in_review";
  return (
    reviews.find(({ state }) => state === "completed")?.practiceStatus ??
    "not_started"
  );
}
