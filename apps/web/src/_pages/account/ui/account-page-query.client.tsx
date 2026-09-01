"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { accountProfileBrowserQueryOptions } from "../api/account-profile-query.browser";
import type { ProfileMutationState } from "../model/member-profile";
import { accountProfileQueryKey } from "../model/account-profile-query";
import { AccountPageClient } from "./account-page.client";
import {
  AccountSignInRequired,
  AccountUnavailable,
} from "./account-page";

type ProfileMutationAction = (
  state: ProfileMutationState,
  formData: FormData,
) => Promise<ProfileMutationState>;

export function AccountPageQuery({
  saveAction,
  viewerScope,
}: {
  readonly saveAction: ProfileMutationAction;
  readonly viewerScope: string;
}) {
  const options = accountProfileBrowserQueryOptions(viewerScope);
  const query = useQuery(options);
  const queryClient = useQueryClient();

  if (query.isPending) {
    return <AccountUnavailable reference="profile-loading" />;
  }
  if (query.isError) {
    return <AccountUnavailable reference="profile-query" />;
  }
  if (query.data.kind === "unauthorized") return <AccountSignInRequired />;
  if (query.data.kind === "unavailable") {
    return <AccountUnavailable reference={query.data.reference} />;
  }

  return (
    <AccountPageClient
      initialProfile={
        query.data.state.kind === "profile" ? query.data.state.profile : null
      }
      onProfileChange={(profile) => {
        queryClient.setQueryData(accountProfileQueryKey(viewerScope), {
          kind: "ready",
          state: { kind: "profile", profile },
        });
      }}
      saveAction={saveAction}
    />
  );
}
