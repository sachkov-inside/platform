"use client";

import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import {
  selfRefreshingRead,
  unavailableRetryIntervalMs,
} from "@/shared/api/self-refreshing-query";
import type { IdentityEmail } from "@/shared/auth/identity-account-contract";
import { readAccountEmail } from "../api/account-email.browser";

const queryKey = ["account", "sign-in-email"] as const;
const emailAttached = factAnnouncement("inside.account-email.attached");

function refreshAccountEmail(client: QueryClient) {
  return client.invalidateQueries({ queryKey }, { cancelRefetch: false });
}

export function useAccountEmailQuery() {
  const client = useQueryClient();
  const query = useQuery({
    ...selfRefreshingRead,
    queryKey,
    queryFn: readAccountEmail,
    refetchInterval: ({ state }) =>
      state.data?.ok === false && state.data.code !== "unauthorized"
        ? unavailableRetryIntervalMs
        : false,
  });
  useEffect(
    () =>
      emailAttached.subscribe(() => {
        void refreshAccountEmail(client);
      }),
    [client],
  );

  async function publishAttachedEmail(email: string) {
    client.setQueryData<IdentityEmail>(queryKey, () => ({ ok: true, email }));
    emailAttached.announce();
    await refreshAccountEmail(client);
  }
  return { query, publishAttachedEmail };
}
