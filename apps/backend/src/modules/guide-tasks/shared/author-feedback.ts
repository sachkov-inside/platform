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
