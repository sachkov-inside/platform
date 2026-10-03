import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import type {
  CourseAssistantPrisma,
  CourseAssistantPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { costNanoUsd } from "../../domain/assistant-usage.js";
import { practiceStatusOf } from "../../domain/practice-review.js";
import {
  candidateId,
  candidatesOf,
  requestedCandidateSchema,
  requestOf,
  reviewCandidateSchema,
  selectCandidate,
  type ReviewCandidate,
} from "../../domain/review-candidate.js";
import { openRepositorySnapshot } from "../../infrastructure/snapshot/repository-snapshot.js";
import type { PracticeContextSource } from "../../ports/practice-context.js";
import type {
  LinkedRepository,
  RepositoryReader,
} from "../../ports/repository-reader.js";
import type { ReviewModel } from "../../ports/review-model.js";
import type { ReviewFailure } from "../../shared/practice-review-view.js";
import { runReviewAgent, type ModelCallUsage } from "./review-agent.js";

export interface PracticeReviewerDependencies {
  readonly prisma: CourseAssistantPrismaClient;
  readonly repositories: RepositoryReader;
  readonly practices: PracticeContextSource;
  readonly model: ReviewModel;
  /** Каталог для временных снимков; снимок удаляется после проверки. */
  readonly snapshotDirectory: string;
  readonly clock: () => Date;
}

/** Снимки, оставшиеся от процесса, который остановился посреди проверки. */
export async function removeLeftoverSnapshots(
  dependencies: Pick<PracticeReviewerDependencies, "snapshotDirectory">,
): Promise<void> {
  await rm(dependencies.snapshotDirectory, { recursive: true, force: true });
}

export type RunPracticeReviewResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly state: "skipped" | "awaiting_choice" | "completed" | "failed";
      };
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: "dependency_unavailable" };
    };

interface ClaimedReview {
  readonly id: string;
  readonly accountId: string;
  readonly practiceId: string;
  readonly conversationId: string;
  readonly contextVersion: string;
  readonly requestedAt: Date;
  readonly repository: LinkedRepository;
  readonly requestedCandidate: unknown;
}

/**
 * Выполняет одну Practice Review в worker (#788). Проверку берёт только тот запуск, который
 * перевёл её из `queued` в `running`; повторная доставка задания ничего не делает.
 */
export async function runPracticeReview(
  dependencies: PracticeReviewerDependencies,
  command: { readonly reviewId: string },
): Promise<RunPracticeReviewResult> {
  let review: ClaimedReview | undefined;
  // Расход пишется после каждого вызова модели; неудачная запись ждёт итога проверки здесь,
  // чтобы её не потерял и запасной итог после сбоя.
  const unrecordedUsages: ModelCallUsage[] = [];
  try {
    review = await claim(dependencies, command.reviewId);
    if (review === undefined) return { ok: true, value: { state: "skipped" } };
    return {
      ok: true,
      value: {
        state: await performReview(dependencies, review, unrecordedUsages),
      },
    };
  } catch (error) {
    if (review !== undefined)
      await finish(dependencies, review, {
        failure: {
          code: "dependency_unavailable",
          currentContextVersion: null,
        },
        unrecordedUsages,
      }).catch((cause: unknown) => {
        reportDependencyFailure(
          { module: "course-assistant", operation: "runPracticeReview" },
          cause,
        );
      });
    return dependencyFailure(
      { module: "course-assistant", operation: "runPracticeReview" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } } as const,
    );
  }
}

async function claim(
  dependencies: PracticeReviewerDependencies,
  reviewId: string,
): Promise<ClaimedReview | undefined> {
  const claimed = await dependencies.prisma.practiceReview.updateMany({
    where: { id: reviewId, state: "queued" },
    data: { state: "running", startedAt: dependencies.clock() },
  });
  if (claimed.count === 0) return undefined;
  const row = await dependencies.prisma.practiceReview.findUniqueOrThrow({
    where: { id: reviewId },
    select: {
      id: true,
      accountId: true,
      practiceId: true,
      conversationId: true,
      contextVersion: true,
      requestedAt: true,
      installationId: true,
      repositoryId: true,
      repositoryFullName: true,
      requestedCandidate: true,
    },
  });
  return {
    id: row.id,
    accountId: row.accountId,
    practiceId: row.practiceId,
    conversationId: row.conversationId,
    contextVersion: row.contextVersion,
    requestedAt: row.requestedAt,
    repository: {
      installationId: Number(row.installationId),
      repositoryId: Number(row.repositoryId),
      fullName: row.repositoryFullName,
    },
    requestedCandidate: row.requestedCandidate,
  };
}

async function performReview(
  dependencies: PracticeReviewerDependencies,
  review: ClaimedReview,
  unrecordedUsages: ModelCallUsage[],
): Promise<"skipped" | "awaiting_choice" | "completed" | "failed"> {
  const fail = async (failure: ReviewFailure) => {
    await finish(dependencies, review, { failure, unrecordedUsages });
    return "failed" as const;
  };
  const context = await dependencies.practices.read({
    accountId: review.accountId,
    practiceId: review.practiceId,
    expectedContextVersion: review.contextVersion,
  });
  if (!context.ok)
    return fail({
      code: context.reason,
      currentContextVersion:
        context.reason === "context_version_mismatch"
          ? context.currentContextVersion
          : null,
    });
  const overview = await dependencies.repositories.readOverview(
    review.repository,
  );
  if (!overview.ok) return fail(repositoryFailure(overview.reason));
  const candidates = candidatesOf(overview.overview);
  const requested =
    review.requestedCandidate === null
      ? null
      : requestedCandidateSchema.parse(review.requestedCandidate);
  const candidate = selectCandidate(requested, candidates);
  if (candidate === undefined)
    return (await askToChoose(dependencies, review, candidates))
      ? "awaiting_choice"
      : "skipped";
  // Повторная проверка — только той же работы; вид проверки, заданный при запросе, здесь уточняется.
  const previousReviewId = await previousReviewOfWork(
    dependencies.prisma,
    review,
    candidate,
  );
  const archive = await dependencies.repositories.downloadArchive(
    review.repository,
    candidate.commitSha,
  );
  if (!archive.ok) return fail(repositoryFailure(archive.reason));
  await mkdir(dependencies.snapshotDirectory, { recursive: true });
  const snapshot = await openRepositorySnapshot(
    archive.archive,
    dependencies.snapshotDirectory,
  );
  if (!snapshot.ok) return fail(repositoryFailure("too_large"));
  let outcome: Awaited<ReturnType<typeof runReviewAgent>>;
  try {
    outcome = await runReviewAgent({
      model: dependencies.model,
      context: context.value,
      repositoryFullName: review.repository.fullName,
      candidate,
      overview: overview.overview,
      snapshot: snapshot.value,
      kind: previousReviewId === null ? "initial" : "recheck",
      async recordUsage(usage) {
        try {
          await dependencies.prisma.assistantUsage.createMany({
            data: usageRows(dependencies, review, [usage]),
          });
        } catch (error) {
          reportDependencyFailure(
            { module: "course-assistant", operation: "runPracticeReview" },
            error,
          );
          unrecordedUsages.push(usage);
        }
      },
      async compareChanges() {
        if (candidate.kind !== "pull_request") return undefined;
        const compared = await dependencies.repositories.compareCommits(
          review.repository,
          candidate.baseSha,
          candidate.commitSha,
        );
        return compared.ok ? compared.files : undefined;
      },
    });
  } finally {
    // Код участника живёт только на время проверки. Если удаление не удалось, остаток убирает
    // следующий запуск worker; итог проверки от этого не зависит.
    await snapshot.value.dispose().catch((error: unknown) => {
      reportDependencyFailure(
        { module: "course-assistant", operation: "runPracticeReview" },
        error,
      );
    });
  }
  if (!outcome.ok)
    return fail({ code: outcome.reason, currentContextVersion: null });
  await finish(dependencies, review, {
    completed: { report: outcome.report, candidate, previousReviewId },
    unrecordedUsages,
  });
  return "completed";
}

function repositoryFailure(
  reason: "revoked" | "too_large" | "dependency_unavailable",
): ReviewFailure {
  return {
    code:
      reason === "revoked"
        ? "repository_access_revoked"
        : reason === "too_large"
          ? "repository_too_large"
          : "dependency_unavailable",
    currentContextVersion: null,
  };
}

async function askToChoose(
  dependencies: PracticeReviewerDependencies,
  review: ClaimedReview,
  candidates: readonly ReviewCandidate[],
): Promise<boolean> {
  const now = dependencies.clock();
  return dependencies.prisma.$transaction(async (transaction) => {
    const asking = await transaction.practiceReview.updateMany({
      where: { id: review.id, state: "running" },
      data: {
        state: "awaiting_choice",
        candidates: candidates.map((candidate) => ({ ...candidate })),
        startedAt: null,
      },
    });
    // Проверку уже закрыли как прерванную: вопрос не задаётся.
    if (asking.count === 0) return false;
    // Вопрос задаётся один раз; повторный выбор в той же проверке его не дублирует.
    const asked = await transaction.assistantMessage.count({
      where: { reviewId: review.id, kind: "candidate_question" },
    });
    if (asked === 0)
      await transaction.assistantMessage.create({
        data: {
          id: randomUUID(),
          conversationId: review.conversationId,
          role: "assistant",
          kind: "candidate_question",
          reviewId: review.id,
          createdAt: now,
        },
      });
    return true;
  });
}

/**
 * Итог проверки, её сообщение помощника и ещё не записанный Assistant Usage записываются вместе.
 */
async function finish(
  dependencies: PracticeReviewerDependencies,
  review: ClaimedReview,
  outcome: { readonly unrecordedUsages: readonly ModelCallUsage[] } & (
    | {
        readonly completed: {
          readonly report: Parameters<typeof practiceStatusOf>[0];
          readonly candidate: ReviewCandidate;
          readonly previousReviewId: string | null;
        };
      }
    | { readonly failure: ReviewFailure }
  ),
): Promise<void> {
  const now = dependencies.clock();
  await dependencies.prisma.$transaction(async (transaction) => {
    const finished = await transaction.practiceReview.updateMany({
      where: { id: review.id, state: "running" },
      data:
        "completed" in outcome
          ? {
              state: "completed",
              report: outcome.completed.report,
              practiceStatus: practiceStatusOf(outcome.completed.report),
              checkedCandidate: outcome.completed.candidate,
              previousReviewId: outcome.completed.previousReviewId,
              kind:
                outcome.completed.previousReviewId === null
                  ? "initial"
                  : "recheck",
              completedAt: now,
            }
          : { state: "failed", failure: outcome.failure, completedAt: now },
    });
    // Расход записывается всегда: и поздний вызов модели оплачен поставщиком.
    if (outcome.unrecordedUsages.length > 0)
      await transaction.assistantUsage.createMany({
        data: usageRows(dependencies, review, outcome.unrecordedUsages),
      });
    // Проверку уже закрыли как прерванную: поздний итог статус и беседу не меняет.
    if (finished.count === 0) return;
    await transaction.assistantMessage.create({
      data: {
        id: randomUUID(),
        conversationId: review.conversationId,
        role: "assistant",
        kind: "review_result",
        reviewId: review.id,
        createdAt: now,
      },
    });
  });
}

/**
 * Прошлая завершённая проверка той же работы того же репозитория: другая ветка, PR или
 * репозиторий — не повторная проверка, и «было:» у критериев к ней не относится.
 */
async function previousReviewOfWork(
  prisma: Pick<CourseAssistantPrisma, "practiceReview">,
  review: ClaimedReview,
  candidate: ReviewCandidate,
): Promise<string | null> {
  const earlier = await prisma.practiceReview.findMany({
    where: {
      accountId: review.accountId,
      practiceId: review.practiceId,
      repositoryId: BigInt(review.repository.repositoryId),
      state: "completed",
      requestedAt: { lt: review.requestedAt },
    },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    select: { id: true, checkedCandidate: true },
  });
  const work = candidateId(requestOf(candidate));
  return (
    earlier.find(({ checkedCandidate }) => {
      const checked = reviewCandidateSchema.safeParse(checkedCandidate);
      return checked.success && candidateId(requestOf(checked.data)) === work;
    })?.id ?? null
  );
}

function usageRows(
  dependencies: PracticeReviewerDependencies,
  review: ClaimedReview,
  usages: readonly ModelCallUsage[],
) {
  const { model } = dependencies;
  const now = dependencies.clock();
  return usages.map((usage) => ({
    id: randomUUID(),
    accountId: review.accountId,
    practiceId: review.practiceId,
    conversationId: review.conversationId,
    reviewId: review.id,
    step: usage.step,
    provider: model.provider,
    model: usage.modelId,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
    costNanoUsd:
      model.prices === undefined ? null : costNanoUsd(usage, model.prices),
    priceTableVersion: model.prices?.version ?? null,
    createdAt: now,
  }));
}
