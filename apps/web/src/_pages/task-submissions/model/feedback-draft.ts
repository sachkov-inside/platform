import type { SaveAuthorFeedbackResult } from "./author-feedback";
import type { AuthorFeedback } from "./task-submissions";

export interface FeedbackDraft {
  readonly comment: string;
  readonly reviewed: boolean;
  readonly saved: AuthorFeedback | null;
  readonly sourceRevision: string;
  /** A cleared answer has no server timestamp. Keep the acknowledged deletion for this session. */
  readonly clearedLocally: boolean;
  readonly pending: boolean;
  readonly result: SaveAuthorFeedbackResult | null;
}

function revisionOf(feedback: AuthorFeedback | null): string {
  return JSON.stringify(
    feedback === null
      ? null
      : [feedback.comment, feedback.reviewedAt, feedback.updatedAt],
  );
}

export function initialFeedbackDraft(
  feedback: AuthorFeedback | null,
): FeedbackDraft {
  return {
    comment: feedback?.comment ?? "",
    reviewed: feedback !== null && feedback.reviewedAt !== null,
    saved: feedback,
    sourceRevision: revisionOf(feedback),
    clearedLocally: false,
    pending: false,
    result: null,
  };
}

export function feedbackChanged(draft: FeedbackDraft): boolean {
  return (
    draft.comment.trim() !== (draft.saved?.comment ?? "") ||
    draft.reviewed !== (draft.saved !== null && draft.saved.reviewedAt !== null)
  );
}

/** RSC navigation can deliver an earlier read after a mutation has already answered. */
export function reconcileFeedbackDraft(
  stored: FeedbackDraft | undefined,
  feedback: AuthorFeedback | null,
): FeedbackDraft {
  if (stored === undefined) return initialFeedbackDraft(feedback);
  const revision = revisionOf(feedback);
  if (
    stored.pending ||
    stored.clearedLocally ||
    revision === stored.sourceRevision ||
    revision === revisionOf(stored.saved) ||
    (feedback !== null &&
      stored.saved !== null &&
      Date.parse(feedback.updatedAt) < Date.parse(stored.saved.updatedAt))
  )
    return stored;
  const fresh = initialFeedbackDraft(feedback);
  return feedbackChanged(stored)
    ? { ...fresh, comment: stored.comment, reviewed: stored.reviewed }
    : fresh;
}
