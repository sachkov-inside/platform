"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import { accountPresentationBrowserQueryOptions } from "../api/account-presentation-query.browser";
import { accountPresentationQueryKey } from "./account-presentation-query";

export const accountProfileChanged = factAnnouncement(
  "inside.account-profile.changed",
);

export function useAccountPresentation({
  enabled = true,
}: { readonly enabled?: boolean } = {}) {
  const client = useQueryClient();
  const query = useQuery({
    ...accountPresentationBrowserQueryOptions(),
    enabled,
  });
  useEffect(
    () =>
      accountProfileChanged.subscribe(() => {
        void client.invalidateQueries(
          { queryKey: accountPresentationQueryKey() },
          { cancelRefetch: false },
        );
      }),
    [client],
  );
  return query;
}
