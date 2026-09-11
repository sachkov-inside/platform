"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  accountPresentationBrowserQueryOptions,
  accountPresentationQueryKey,
  type AccountPresentationResult,
} from "@/features/account-access";
import { AccountPageClient } from "./account-page.client";
import {
  AccountLoading,
  AccountSignInRequired,
  AccountUnavailable,
} from "./account-page";

export function AccountPageQuery() {
  const options = accountPresentationBrowserQueryOptions();
  const query = useQuery(options);
  const queryClient = useQueryClient();

  if (query.isPending) {
    return <AccountLoading />;
  }
  if (query.isError && query.data === undefined) {
    return <AccountUnavailable reference="account-query" />;
  }
  if (query.data.kind === "unauthorized") return <AccountSignInRequired />;
  return (
    <AccountPageClient
      initialProfile={
        query.data.presentation.profile.kind === "profile"
          ? query.data.presentation.profile.profile
          : null
      }
      onProfileChange={(profile) => {
        queryClient.setQueryData<AccountPresentationResult>(
          accountPresentationQueryKey(),
          (current) =>
            current?.kind === "ready"
              ? {
                  kind: "ready",
                  presentation: {
                    ...current.presentation,
                    profile: { kind: "profile", profile },
                  },
                }
              : current,
        );
      }}
    />
  );
}
