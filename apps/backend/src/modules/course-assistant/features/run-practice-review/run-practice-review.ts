import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import type { CourseAssistantPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { costNanoUsd } from "../../domain/assistant-usage.js";
import {
  practiceStatusOf,
  reviewKindOf,
} from "../../domain/practice-review.js";
import {
  candidatesOf,
  requestedCandidateSchema,
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
  readonly kind: string;
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
  try {
    review = await claim(dependencies, command.reviewId);
    if (review === undefined) return { ok: true, value: { state: "skipped" } };
    return {
      ok: true,
      value: { state: await performReview(dependencies, review) },
    };
  } catch (error) {
    if (review !== undefined)
      await finish(dependencies, review, {
        failure: {
          code: "dependency_unavailable",
          currentContextVersion: null,
        },
        usages: [],
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
      kind: true,
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
    kind: row.kind,
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
): Promise<"awaiting_choice" | "completed" | "failed"> {
  const fail = async (
    failure: ReviewFailure,
    usages: readonly ModelCallUsage[] = [],
  ) => {
    await finish(dependencies, review, { failure, usages });
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
  if (candidate === undefined) {
    await askToChoose(dependencies, review, candidates);
    return "awaiting_choice";
  }
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
      kind: reviewKindOf(review.kind),
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
    // Код участника живёт только на время проверки.
    await snapshot.value.dispose();
  }
  if (!outcome.ok)
    return fail(
      { code: outcome.reason, currentContextVersion: null },
      outcome.usages,
    );
  await finish(dependencies, review, {
    completed: { report: outcome.report, candidate },
    usages: outcome.usages,
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
): Promise<void> {
  const now = dependencies.clock();
  await dependencies.prisma.$transaction(async (transaction) => {
    await transaction.practiceReview.update({
      where: { id: review.id },
      data: {
        state: "awaiting_choice",
        candidates: candidates.map((candidate) => ({ ...candidate })),
        startedAt: null,
      },
    });
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
  });
}

/** Итог проверки, её Assistant Usage и сообщение помощника записываются вместе. */
async function finish(
  dependencies: PracticeReviewerDependencies,
  review: ClaimedReview,
  outcome: { readonly usages: readonly ModelCallUsage[] } & (
    | {
        readonly completed: {
          readonly report: Parameters<typeof practiceStatusOf>[0];
          readonly candidate: ReviewCandidate;
        };
      }
    | { readonly failure: ReviewFailure }
  ),
): Promise<void> {
  const now = dependencies.clock();
  const { model } = dependencies;
  await dependencies.prisma.$transaction(async (transaction) => {
    const previous =
      "completed" in outcome
        ? await transaction.practiceReview.findFirst({
            where: {
              accountId: review.accountId,
              practiceId: review.practiceId,
              state: "completed",
              requestedAt: { lt: review.requestedAt },
            },
            orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
            select: { id: true },
          })
        : null;
    const finished = await transaction.practiceReview.updateMany({
      where: { id: review.id, state: "running" },
      data:
        "completed" in outcome
          ? {
              state: "completed",
              report: outcome.completed.report,
              practiceStatus: practiceStatusOf(outcome.completed.report),
              checkedCandidate: outcome.completed.candidate,
              previousReviewId: previous?.id ?? null,
              completedAt: now,
            }
          : { state: "failed", failure: outcome.failure, completedAt: now },
    });
    // Расход записывается всегда: и поздний вызов модели оплачен поставщиком.
    if (outcome.usages.length > 0)
      await transaction.assistantUsage.createMany({
        data: outcome.usages.map((usage) => ({
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
            model.prices === undefined
              ? null
              : costNanoUsd(usage, model.prices),
          priceTableVersion: model.prices?.version ?? null,
          createdAt: now,
        })),
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
