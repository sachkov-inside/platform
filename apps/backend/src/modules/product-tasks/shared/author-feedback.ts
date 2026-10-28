import { z } from "zod";

/**
 * Whether a submission has Author Feedback (#1720). «awaiting» (без комментария, новая): no stored
 * `author_feedback` row. «given» (прокомментирована): the row exists, holding a comment, the
 * legacy «посмотрел автор» mark, or both. Saving an empty comment without the mark deletes the
 * row, so the submission awaits feedback again and the learner reads «not yet».
 */
export const feedbackStateSchema = z.enum(["awaiting", "given"]);
export type FeedbackState = z.infer<typeof feedbackStateSchema>;

/** The submission condition of one feedback state; `feedback` is the optional 1:1 relation. */
export function feedbackStateWhere(state: FeedbackState) {
  return { feedback: state === "awaiting" ? { is: null } : { isNot: null } };
}

/** A stored Author Feedback as the author reads it (#948). */
export interface AuthorFeedback {
  readonly comment: string | null;
  readonly reviewedAt: string | null;
  readonly updatedAt: string;
}

/** One `author_feedback` row as the author's section and the save answer name it. */
export function authorFeedbackOf(row: {
  readonly comment: string | null;
  readonly reviewedAt: Date | null;
  readonly updatedAt: Date;
}): AuthorFeedback {
  return {
    comment: row.comment,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
