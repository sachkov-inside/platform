import {
  criteriaOf,
  defaultFeedbackFilter,
  hasAuthorFeedback,
  submissionsListHref,
  type AuthorSubmission,
  type FeedbackFilter,
  type FilterProduct,
  type SubmissionSelection,
  type TaskCriterion,
  type TaskSubmissions,
} from "./task-submissions";

/** The list state of one submission (#1717): «новая» until Author Feedback exists. */
export type SubmissionFeedbackState =
  "submission.awaiting" | "submission.commented";

/** Client-safe state shared by the production route and the Storybook fixture adapter. */
export interface TaskSubmissionsPresentation {
  readonly pageHref: string;
  readonly submissionId: string | undefined;
  readonly history: readonly (TaskSubmissions["history"][number] & {
    readonly href: string;
  })[];
  readonly products: readonly FilterProduct[];
  readonly selection: SubmissionSelection;
  readonly feedback: FeedbackFilter;
  /** The row cursor of this page and the Product-choice cursor, kept by filter changes. */
  readonly cursor: string | undefined;
  readonly productCursor: string | undefined;
  readonly rows: readonly {
    readonly submission: AuthorSubmission;
    readonly href: string;
    readonly criteria: readonly TaskCriterion[];
    readonly telegramHref: string | null;
    readonly state: SubmissionFeedbackState;
  }[];
  readonly newestHref: string | null;
  readonly nextHref: string | null;
  readonly nextProductsHref: string | null;
  readonly firstProductsHref: string | null;
}

export function submissionFeedbackState(
  submission: AuthorSubmission,
): SubmissionFeedbackState {
  return hasAuthorFeedback(submission)
    ? "submission.commented"
    : "submission.awaiting";
}

export function presentTaskSubmissions({
  continued,
  cursor,
  selection,
  feedback = defaultFeedbackFilter,
  submissions,
  submissionId,
  productCursor,
}: {
  readonly continued: boolean;
  readonly cursor?: string | undefined;
  readonly selection: SubmissionSelection;
  readonly feedback?: FeedbackFilter;
  readonly submissions: TaskSubmissions;
  readonly submissionId?: string | undefined;
  readonly productCursor?: string | undefined;
}): TaskSubmissionsPresentation {
  const href = (
    page: string | undefined,
    submission?: string,
    products: { readonly cursor: string | undefined } = {
      cursor: productCursor,
    },
  ) =>
    submissionsListHref({
      selection,
      feedback,
      cursor: page,
      submissionId: submission,
      productCursor: products.cursor,
    });
  return {
    pageHref: href(cursor),
    submissionId,
    history: submissions.history.map((check) => ({
      ...check,
      href: href(cursor, check.submissionId),
    })),
    products: submissions.products,
    selection,
    feedback,
    cursor,
    productCursor,
    rows: submissions.submissions.map((submission) => ({
      submission,
      href: href(cursor, submission.submissionId),
      criteria: criteriaOf(submissions, submission),
      // Only the supported Telegram destination enters the presentation interface.
      telegramHref:
        submission.person.telegramUsername !== null &&
        submission.person.telegramUrl ===
          `https://t.me/${submission.person.telegramUsername}`
          ? submission.person.telegramUrl
          : null,
      state: submissionFeedbackState(submission),
    })),
    newestHref: continued ? href(undefined) : null,
    nextHref:
      submissions.nextCursor === null ? null : href(submissions.nextCursor),
    firstProductsHref:
      productCursor === undefined
        ? null
        : href(cursor, undefined, { cursor: undefined }),
    nextProductsHref:
      submissions.nextProductCursor === null
        ? null
        : href(cursor, undefined, {
            cursor: submissions.nextProductCursor,
          }),
  };
}
