import type { PeopleDirectoryDependencies } from "../../../src/modules/people-directory/shared/people-composition.js";

/** An owner read the operation under test must not call. */
export const refusedRead = (): Promise<never> =>
  Promise.reject(new Error("This read does not call the owner"));

/**
 * The people directory's owners beyond Accounts and Telegram, for a test that composes the
 * directory over a measured or failing client: identities and the list read none of them, or only
 * the ones the test replaces.
 */
export const unreadPeopleOwners = {
  access: {
    listAccessAccounts: refusedRead,
    readAccessSummaries: refusedRead,
    readAccountProductAccess: refusedRead,
  },
  products: { metadata: refusedRead },
  learning: { readLastActivity: refusedRead, readLearningSummary: refusedRead },
  payments: { execute: refusedRead },
  submissions: { summarizeAccount: refusedRead },
  community: { readMemberState: refusedRead },
  waitlists: { readForAccount: refusedRead },
} satisfies Omit<
  PeopleDirectoryDependencies,
  "accounts" | "directory" | "telegram"
>;
