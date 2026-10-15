/** Personal data never shares a browser cache key across Accounts or history pages. */
export const taskSubmissionsQueryKey = (
  accountId: string | null,
  code: string,
  after?: string,
) => ["own-task-submissions", accountId, code, after ?? null] as const;
export const taskReviewRefreshIntervalMs = 10_000;
