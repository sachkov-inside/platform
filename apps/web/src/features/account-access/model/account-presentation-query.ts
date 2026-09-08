import { queryOptions } from "@tanstack/react-query";

import type { AccountPresentationResult } from "./account-presentation";

export function accountPresentationQueryKey() {
  return ["account", "presentation"] as const;
}

export type LoadAccountPresentation = (input: {
  readonly signal: AbortSignal;
}) => Promise<AccountPresentationResult>;

export type AccountPresentationQueryOptions = ReturnType<
  typeof createAccountPresentationQueryOptions
>;

export function createAccountPresentationQueryOptions(
  loadPresentation: LoadAccountPresentation,
) {
  return queryOptions({
    queryKey: accountPresentationQueryKey(),
    queryFn: async ({ signal }) => {
      const result = await loadPresentation({ signal });
      if (result.kind === "unavailable") throw new Error(result.reference);
      return result;
    },
    retry: false,
  });
}
