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
  readonly products: readonly FilterProduct[];
  readonly selection: SubmissionSelection;
  readonly rows: readonly {
    readonly submission: AuthorSubmission;
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
}: {
  readonly continued: boolean;
  readonly cursor?: string | undefined;
  readonly selection: SubmissionSelection;
  readonly submissions: TaskSubmissions;
}): TaskSubmissionsPresentation {
  return {
    pageHref: selectionHref(selection, cursor),
    products: submissions.products,
    selection,
    rows: submissions.submissions.map((submission) => ({
      submission,
      criteria: criteriaOf(submissions, submission),
    })),
    newestHref: continued ? selectionHref(selection) : null,
    nextHref:
      submissions.nextCursor === null
        ? null
        : selectionHref(selection, submissions.nextCursor),
  };
}
