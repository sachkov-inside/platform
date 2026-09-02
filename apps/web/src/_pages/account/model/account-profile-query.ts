import { queryOptions } from "@tanstack/react-query";

import type { AccountProfileResult } from "../api/request-account-profile";

export function accountProfileQueryKey() {
  return ["account", "profile"] as const;
}

export type LoadAccountProfile = (input: {
  readonly signal: AbortSignal;
}) => Promise<AccountProfileResult>;

export type AccountProfileQueryOptions = ReturnType<
  typeof createAccountProfileQueryOptions
>;

export function createAccountProfileQueryOptions(
  loadProfile: LoadAccountProfile,
) {
  return queryOptions({
    queryKey: accountProfileQueryKey(),
    queryFn: ({ signal }) => loadProfile({ signal }),
  });
}
