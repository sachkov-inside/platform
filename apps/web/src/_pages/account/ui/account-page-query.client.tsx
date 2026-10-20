"use client";

import { useQueryClient } from "@tanstack/react-query";

import {
  useAccountPresentation,
  accountProfileChanged,
  accountPresentationQueryKey,
  type AccountPresentationResult,
} from "@/features/account-access";
import { LearningContinuation } from "@/features/reading-progress";
import { AccountPageClient } from "./account-page.client";
import {
  AccountLoading,
  AccountSignInRequired,
  AccountUnavailable,
} from "./account-page";

export function AccountPageQuery() {
  const query = useAccountPresentation();
  const queryClient = useQueryClient();

  if (query.isPending) {
    return <AccountLoading />;
  }
  if (query.isError && query.data === undefined) {
    return <AccountUnavailable reference="account-query" />;
  }
  if (query.data.kind === "unauthorized") return <AccountSignInRequired />;
  return (
    <>
      <LearningContinuation />
      <AccountPageClient
        initialProfile={
          query.data.presentation.profile.kind === "profile"
            ? query.data.presentation.profile.profile
            : null
        }
        onProfileChange={(profile) => {
          accountProfileChanged.announce();
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
    </>
  );
}
