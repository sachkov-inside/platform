"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import {
  reconcileFeedbackDraft,
  type FeedbackDraft,
} from "../model/feedback-draft";
import type { AuthorFeedback } from "../model/task-submissions";

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
              reconcileFeedbackDraft(current[submissionId], feedback),
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
    draft: reconcileFeedbackDraft(runtime.drafts[submissionId], feedback),
    update: (change: (current: FeedbackDraft) => FeedbackDraft) => {
      runtime.updateDraft(submissionId, feedback, change);
    },
  };
}
