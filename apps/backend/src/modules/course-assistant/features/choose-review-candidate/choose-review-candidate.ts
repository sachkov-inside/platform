import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import { admitsParticipant } from "../../domain/course-assistant-settings.js";
import {
  candidateId,
  candidateLabel,
  requestOf,
  reviewCandidateSchema,
} from "../../domain/review-candidate.js";
import {
  dependencyUnavailable,
  invalidRequest,
  unavailable,
  type CourseAssistantDependencies,
  type CourseAssistantError,
} from "../../shared/course-assistant-dependencies.js";
import { readPracticeReviewView } from "../../shared/practice-reviews.js";
import type { PracticeReviewView } from "../../shared/practice-review-view.js";

export const chooseReviewCandidateSchema = z.strictObject({
  candidateId: z.string().min(1).max(100),
});

export type ChooseReviewCandidateResult =
  | { readonly ok: true; readonly value: PracticeReviewView }
  | {
      readonly ok: false;
      readonly error:
        | CourseAssistantError
        | { readonly code: "review_not_found" }
        | { readonly code: "review_not_awaiting_choice" }
        | { readonly code: "candidate_not_available" }
        | { readonly code: "review_unavailable" };
    };

/**
 * Участник выбрал, какую работу проверять, когда правдоподобных вариантов несколько. Выбор
 * возможен только из вариантов, которые помощник показал в этой проверке.
 */
export async function chooseReviewCandidate(
  dependencies: CourseAssistantDependencies,
  command: {
    readonly accountId: string;
    readonly reviewId: string;
    readonly candidateId: string;
  },
): Promise<ChooseReviewCandidateResult> {
  const accountId = z.uuid().safeParse(command.accountId);
  const reviewId = z.uuid().safeParse(command.reviewId);
  const input = chooseReviewCandidateSchema.safeParse({
    candidateId: command.candidateId,
  });
  if (!accountId.success || !reviewId.success || !input.success)
    return invalidRequest;
  const account = accountId.data.toLowerCase();
  if (!admitsParticipant(dependencies.settings, account)) return unavailable;
  const queue = dependencies.reviewQueue;
  if (queue === null)
    return { ok: false, error: { code: "review_unavailable" } };
  try {
    const review = await dependencies.prisma.practiceReview.findFirst({
      where: { id: reviewId.data, accountId: account },
      select: { state: true, candidates: true, conversationId: true },
    });
    if (review === null)
      return { ok: false, error: { code: "review_not_found" } };
    if (review.state !== "awaiting_choice")
      return { ok: false, error: { code: "review_not_awaiting_choice" } };
    const chosen = z
      .array(reviewCandidateSchema)
      .parse(review.candidates)
      .find(
        (candidate) =>
          candidateId(requestOf(candidate)) === input.data.candidateId,
      );
    if (chosen === undefined)
      return { ok: false, error: { code: "candidate_not_available" } };
    const now = dependencies.clock();
    const chosenNow = await dependencies.prisma.$transaction(
      async (transaction) => {
        const claimed = await transaction.practiceReview.updateMany({
          where: {
            id: reviewId.data,
            accountId: account,
            state: "awaiting_choice",
          },
          data: { state: "queued", requestedCandidate: requestOf(chosen) },
        });
        if (claimed.count === 0) return false;
        await transaction.assistantMessage.create({
          data: {
            id: randomUUID(),
            conversationId: review.conversationId,
            role: "participant",
            kind: "text",
            text: `Проверить: ${candidateLabel(chosen)}`.slice(0, 4_000),
            reviewId: reviewId.data,
            createdAt: now,
          },
        });
        return true;
      },
    );
    // Параллельный выбор записался первым: его вариант и есть ответ.
    if (!chosenNow)
      return { ok: false, error: { code: "review_not_awaiting_choice" } };
    try {
      await queue.enqueue(reviewId.data);
    } catch (error) {
      // Проверка уже `queued`: worker подберёт её сам.
      reportDependencyFailure(
        { module: "course-assistant", operation: "chooseReviewCandidate" },
        error,
      );
    }
    const view = await readPracticeReviewView(dependencies.prisma, {
      accountId: account,
      reviewId: reviewId.data,
    });
    return view === null ? dependencyUnavailable : { ok: true, value: view };
  } catch (error) {
    return dependencyFailure(
      { module: "course-assistant", operation: "chooseReviewCandidate" },
      error,
      dependencyUnavailable,
    );
  }
}
