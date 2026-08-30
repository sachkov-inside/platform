import { queryOptions } from "@tanstack/react-query";

import type { PrivateMemberProfileResult } from "./member-profile";

export function accountProfileQueryKey(viewerScope: string) {
  return ["account", "profile", viewerScope] as const;
}

export type LoadAccountProfile = (input: {
  readonly signal: AbortSignal;
}) => Promise<PrivateMemberProfileResult>;

export type AccountProfileQueryOptions = ReturnType<
  typeof createAccountProfileQueryOptions
>;

export function createAccountProfileQueryOptions(
  loadProfile: LoadAccountProfile,
  viewerScope: string,
) {
  return queryOptions({
    queryKey: accountProfileQueryKey(viewerScope),
    queryFn: ({ signal }) => loadProfile({ signal }),
  });
}
