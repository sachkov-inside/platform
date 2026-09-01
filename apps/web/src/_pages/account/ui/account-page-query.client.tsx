"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { accountProfileBrowserQueryOptions } from "../api/account-profile-query.browser";
import { accountProfileQueryKey } from "../model/account-profile-query";
import { AccountPageClient } from "./account-page.client";
import {
  AccountSignInRequired,
  AccountUnavailable,
} from "./account-page";

export function AccountPageQuery() {
  const options = accountProfileBrowserQueryOptions();
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
  const canManageMaterials = query.data.canManageMaterials;

  return (
    <AccountPageClient
      canManageMaterials={canManageMaterials}
      initialProfile={
        query.data.state.kind === "profile" ? query.data.state.profile : null
      }
      onProfileChange={(profile) => {
        queryClient.setQueryData(accountProfileQueryKey(), {
          canManageMaterials,
          kind: "ready",
          state: { kind: "profile", profile },
        });
      }}
    />
  );
}
