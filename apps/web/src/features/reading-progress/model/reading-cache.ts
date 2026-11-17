import type { QueryClient } from "@tanstack/react-query";

/** Remove other Accounts' reading and bookmark query/mutation data, keeping the current Account's. */
export function clearOtherReadingAccounts(
  client: QueryClient,
  accountId: string | null,
) {
  const isOtherAccount = (key: readonly unknown[] | undefined) =>
    (key?.[0] === "reading-progress" || key?.[0] === "bookmarks") &&
    (accountId === null || key[1] !== accountId);
  void client.cancelQueries({
    predicate: (query) => isOtherAccount(query.queryKey),
  });
  client.removeQueries({
    predicate: (query) => isOtherAccount(query.queryKey),
  });
  for (const mutation of client.getMutationCache().getAll()) {
    if (isOtherAccount(mutation.options.mutationKey))
      client.getMutationCache().remove(mutation);
  }
}
