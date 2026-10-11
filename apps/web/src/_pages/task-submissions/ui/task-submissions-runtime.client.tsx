"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import type { SaveAuthorFeedbackResult } from "../model/author-feedback";
import type { AuthorFeedback } from "../model/task-submissions";

export interface FeedbackDraft {
  readonly comment: string;
  readonly reviewed: boolean;
  readonly saved: AuthorFeedback | null;
  readonly sourceRevision: string | null;
  readonly pending: boolean;
  readonly result: SaveAuthorFeedbackResult | null;
}

function initialDraft(feedback: AuthorFeedback | null): FeedbackDraft {
  return {
    comment: feedback?.comment ?? "",
    reviewed: feedback !== null && feedback.reviewedAt !== null,
    saved: feedback,
    sourceRevision: feedback?.updatedAt ?? null,
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

function reconcileDraft(
  stored: FeedbackDraft | undefined,
  feedback: AuthorFeedback | null,
): FeedbackDraft {
  if (stored === undefined) return initialDraft(feedback);
  const revision = feedback?.updatedAt ?? null;
  // An RSC result can still contain the pre-save answer. A newer server read updates the baseline
  // while an unsaved edit remains the author's own draft.
  if (
    stored.pending ||
    revision === stored.sourceRevision ||
    revision === (stored.saved?.updatedAt ?? null)
  )
    return stored;
  const fresh = initialDraft(feedback);
  return feedbackChanged(stored)
    ? { ...fresh, comment: stored.comment, reviewed: stored.reviewed }
    : fresh;
}

interface Runtime {
  readonly drafts: Readonly<Record<string, FeedbackDraft>>;
  readonly selected: Readonly<Record<string, string>>;
  readonly choose: (pageHref: string, submissionId: string) => void;
  readonly updateDraft: (
    submissionId: string,
    feedback: AuthorFeedback | null,
    update: (current: FeedbackDraft) => FeedbackDraft,
  ) => void;
}

const Context = createContext<Runtime | null>(null);

/** The submissions layout retains drafts across selection, loading, filters and pagination.
 * Nothing is written to browser storage; a full document reload ends this editing session.
 */
export function TaskSubmissionsRuntime({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [drafts, setDrafts] = useState<Runtime["drafts"]>({});
  const [selected, setSelected] = useState<Runtime["selected"]>({});
  return (
    <Context.Provider
      value={{
        drafts,
        selected,
        choose: (pageHref, submissionId) => {
          setSelected((current) => ({ ...current, [pageHref]: submissionId }));
        },
        updateDraft: (submissionId, feedback, update) => {
          setDrafts((current) => ({
            ...current,
            [submissionId]: update(
              reconcileDraft(current[submissionId], feedback),
            ),
          }));
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useTaskSubmissionsRuntime(): Runtime {
  const runtime = useContext(Context);
  if (runtime === null) throw new Error("TaskSubmissionsRuntime is required");
  return runtime;
}

export function useFeedbackDraft(
  submissionId: string,
  feedback: AuthorFeedback | null,
) {
  const runtime = useTaskSubmissionsRuntime();
  return {
    draft: reconcileDraft(runtime.drafts[submissionId], feedback),
    update: (change: (current: FeedbackDraft) => FeedbackDraft) => {
      runtime.updateDraft(submissionId, feedback, change);
    },
  };
}
