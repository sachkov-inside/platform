import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { feedbackStateWhere } from "../../shared/author-feedback.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";
import type { SubmissionReviewDependencies } from "../../shared/submission-review-dependencies.js";

export type CountAwaitingFeedbackError =
  { readonly code: "forbidden" } | SystemError;

export type CountAwaitingFeedbackResult = Result<
  { readonly count: number },
  CountAwaitingFeedbackError
>;

/**
 * How many submissions await Author Feedback (#1720): those without a stored `author_feedback`
 * row, as the `awaiting` filter of the author's list reads them (see `feedbackStateSchema`). The
 * menu counter of «Сдачи». Requires `materials:manage`, as the list does; another Account is
 * refused rather than answered with zero.
 */
export async function countSubmissionsAwaitingFeedback(
  dependencies: Pick<SubmissionReviewDependencies, "prisma" | "authorPolicy">,
  actorId: string,
): Promise<CountAwaitingFeedbackResult> {
  try {
    if (!(await dependencies.authorPolicy.canManage(actorId)))
      return { ok: false, error: { code: "forbidden" } };
    // An anti-join on the `author_feedback` primary key, so the count needs no extra index.
    const count = await dependencies.prisma.productTaskSubmission.count({
      where: feedbackStateWhere("awaiting"),
    });
    return { ok: true, value: { count } };
  } catch (error) {
    return dependencyFailure(
      scope("countSubmissionsAwaitingFeedback"),
      error,
      systemFailure(error),
    );
  }
}
