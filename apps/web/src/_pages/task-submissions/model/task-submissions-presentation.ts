import {
  criteriaOf,
  selectionHref,
  type AuthorSubmission,
  type FilterProduct,
  type SubmissionSelection,
  type TaskCriterion,
  type TaskSubmissions,
} from "./task-submissions";

/** Client-safe state shared by the production route and the Storybook fixture adapter. */
export interface TaskSubmissionsPresentation {
  readonly pageHref: string;
  readonly submissionId: string | undefined;
  readonly history: readonly (TaskSubmissions["history"][number] & {
    readonly href: string;
  })[];
  readonly products: readonly FilterProduct[];
  readonly selection: SubmissionSelection;
  readonly rows: readonly {
    readonly submission: AuthorSubmission;
    readonly href: string;
    readonly criteria: readonly TaskCriterion[];
  }[];
  readonly newestHref: string | null;
  readonly nextHref: string | null;
}

export function presentTaskSubmissions({
  continued,
  cursor,
  selection,
  submissions,
  submissionId,
}: {
  readonly continued: boolean;
  readonly cursor?: string | undefined;
  readonly selection: SubmissionSelection;
  readonly submissions: TaskSubmissions;
  readonly submissionId?: string | undefined;
}): TaskSubmissionsPresentation {
  return {
    pageHref: selectionHref(selection, cursor),
    submissionId,
    history: submissions.history.map((check) => ({
      ...check,
      href: selectionHref(selection, cursor, check.submissionId),
    })),
    products: submissions.products,
    selection,
    rows: submissions.submissions.map((submission) => ({
      submission,
      href: selectionHref(selection, cursor, submission.submissionId),
      criteria: criteriaOf(submissions, submission),
    })),
    newestHref: continued ? selectionHref(selection) : null,
    nextHref:
      submissions.nextCursor === null
        ? null
        : selectionHref(selection, submissions.nextCursor),
  };
}
