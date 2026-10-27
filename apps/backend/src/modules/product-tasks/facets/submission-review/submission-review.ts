import { countSubmissionsAwaitingFeedback } from "../../features/count-awaiting-feedback/count-awaiting-feedback.js";
import { listAuthorSubmissions } from "../../features/list-author-submissions/list-author-submissions.js";
import { saveAuthorFeedback } from "../../features/save-author-feedback/save-author-feedback.js";
import type { SubmissionReviewDependencies } from "../../shared/submission-review-dependencies.js";

export const SUBMISSION_REVIEW = Symbol("SUBMISSION_REVIEW");

/**
 * The author's «Сдачи» section (#948): submissions by Product, chapter, task and feedback state,
 * the count of those awaiting Author Feedback (#1720), and Author Feedback itself. Every operation
 * requires `materials:manage`.
 */
export interface SubmissionReview {
  readonly list: (
    actorId: string,
    input: unknown,
  ) => ReturnType<typeof listAuthorSubmissions>;
  readonly countAwaitingFeedback: (
    actorId: string,
  ) => ReturnType<typeof countSubmissionsAwaitingFeedback>;
  readonly saveFeedback: (
    actorId: string,
    input: unknown,
  ) => ReturnType<typeof saveAuthorFeedback>;
}

export function assembleSubmissionReview(
  dependencies: SubmissionReviewDependencies,
): SubmissionReview {
  return Object.freeze<SubmissionReview>({
    list: (actorId, input) =>
      listAuthorSubmissions(dependencies, actorId, input),
    countAwaitingFeedback: (actorId) =>
      countSubmissionsAwaitingFeedback(dependencies, actorId),
    saveFeedback: (actorId, input) =>
      saveAuthorFeedback(dependencies, actorId, input),
  });
}
