"use client";

import { useQuery } from "@tanstack/react-query";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import { accountPresentationBrowserQueryOptions } from "../api/account-presentation-query.browser";
import { accountPresentationQueryKey } from "./account-presentation-query";

export const accountProfileChanged = factAnnouncement(
  "inside.account-profile.changed",
);

export function useAccountPresentation({
  enabled = true,
}: { readonly enabled?: boolean } = {}) {
  const query = useQuery({
    ...accountPresentationBrowserQueryOptions(),
    enabled,
  });
  useAnnouncedRefresh(accountProfileChanged, accountPresentationQueryKey());
  return query;
}
