"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  reconcileFeedbackDraft,
  type FeedbackDraft,
} from "../model/feedback-draft";
import type { AuthorFeedback } from "../model/task-submissions";

interface Runtime {
  readonly drafts: Readonly<Record<string, FeedbackDraft>>;
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
  const updateDraft = useCallback<Runtime["updateDraft"]>(
    (submissionId, feedback, update) => {
      setDrafts((current) => {
        const previous = current[submissionId];
        const next = update(reconcileFeedbackDraft(previous, feedback));
        return next === previous
          ? current
          : { ...current, [submissionId]: next };
      });
    },
    [],
  );
  return (
    <Context.Provider
      value={{
        drafts,
        updateDraft,
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
  const { updateDraft } = runtime;
  // Retain accepted server reads as well as local writes, so navigating back cannot lower the
  // revision. The setter is stable and skips unchanged state for the queue and detail consumers.
  useEffect(() => {
    updateDraft(submissionId, feedback, (current) => current);
  }, [updateDraft, submissionId, feedback]);
  return {
    draft: reconcileFeedbackDraft(runtime.drafts[submissionId], feedback),
    update: (change: (current: FeedbackDraft) => FeedbackDraft) => {
      runtime.updateDraft(submissionId, feedback, change);
    },
  };
}
