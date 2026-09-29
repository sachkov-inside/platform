import { randomUUID } from "node:crypto";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { CourseAssistantPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ReviewFailure } from "../../shared/practice-review-view.js";

/** Постановка в очередь могла потеряться: такая проверка ждёт worker не дольше этого. */
export const queuedReviewGraceMilliseconds = 30_000;
/** Проверка дольше этого считается прерванной: процесс worker остановился посреди неё. */
export const runningReviewTimeoutMilliseconds = 15 * 60 * 1000;

export type ResumeStalledReviewsResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly queued: readonly string[];
        readonly interrupted: readonly string[];
      };
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: "dependency_unavailable" };
    };

/**
 * Страховка очереди проверок (#788): возвращает давно поставленные проверки для запуска и
 * закрывает как прерванные те, что зависли в `running`. Прерванная проверка статус не меняет;
 * участник запускает её заново.
 */
export async function resumeStalledReviews(dependencies: {
  readonly prisma: CourseAssistantPrismaClient;
  readonly clock: () => Date;
}): Promise<ResumeStalledReviewsResult> {
  const now = dependencies.clock();
  try {
    const queued = await dependencies.prisma.practiceReview.findMany({
      where: {
        state: "queued",
        requestedAt: {
          lt: new Date(now.getTime() - queuedReviewGraceMilliseconds),
        },
      },
      orderBy: { requestedAt: "asc" },
      select: { id: true },
      take: 50,
    });
    const stalled = await dependencies.prisma.practiceReview.findMany({
      where: {
        state: "running",
        startedAt: {
          lt: new Date(now.getTime() - runningReviewTimeoutMilliseconds),
        },
      },
      select: { id: true, conversationId: true },
      take: 50,
    });
    const interrupted: string[] = [];
    const failure: ReviewFailure = {
      code: "interrupted",
      currentContextVersion: null,
    };
    for (const review of stalled) {
      const closed = await dependencies.prisma.$transaction(
        async (transaction) => {
          const updated = await transaction.practiceReview.updateMany({
            where: { id: review.id, state: "running" },
            data: { state: "failed", failure, completedAt: now },
          });
          if (updated.count === 0) return false;
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
          return true;
        },
      );
      if (closed) interrupted.push(review.id);
    }
    return {
      ok: true,
      value: { queued: queued.map(({ id }) => id), interrupted },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "resumeStalledReviews" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } } as const,
    );
  }
}
