import "server-only";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { resolveAccount } from "@/shared/api/backend/index.server";
import { getQueryClient } from "@/shared/api/query-client";
import { getPersonalHome } from "../api/get-personal-home.server";
import { personalHomeQueryKey } from "../model/personal-home-contract";
import { SavedPersonalHome } from "./saved-personal-home.client";

export async function PersonalHome({ accessToken }: { readonly accessToken: string | undefined }) {
  let accountId: string | null = null;
  const client = getQueryClient();
  if (accessToken !== undefined) {
    try {
      accountId = (await resolveAccount(accessToken)).accountId;
      await client.query({ queryKey: personalHomeQueryKey(accountId), queryFn: () => getPersonalHome(accessToken) });
    } catch { accountId = null; }
  }
  return <HydrationBoundary state={dehydrate(client)}><SavedPersonalHome initialAccountId={accountId} /></HydrationBoundary>;
}
