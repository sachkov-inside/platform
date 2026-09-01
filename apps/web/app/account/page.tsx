import type { Metadata } from "next";
import { connection } from "next/server";
import { createHash } from "node:crypto";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import {
  AccountPageQuery,
  AccountSignInRequired,
  AccountUnavailable,
} from "@/_pages/account";
import {
  accountProfileServerQueryOptions,
  saveMemberProfileAction,
} from "@/_pages/account.server";
import { getQueryClient } from "@/shared/api/query-client";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

export const metadata: Metadata = {
  title: "Аккаунт",
  robots: { follow: false, index: false },
};

export default async function Page() {
  await connection();
  let accessToken: string | undefined;
  try {
    accessToken = await getOptionalPlatformAccessToken();
  } catch {
    return <AccountUnavailable reference="account-session" />;
  }
  if (accessToken === undefined) return <AccountSignInRequired />;

  const viewerScope = `authenticated:${createHash("sha256")
    .update(accessToken)
    .digest("base64url")}`;
  const queryClient = getQueryClient();
  await queryClient.query(
    accountProfileServerQueryOptions(viewerScope, accessToken),
  );

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AccountPageQuery
        saveAction={saveMemberProfileAction}
        viewerScope={viewerScope}
      />
    </HydrationBoundary>
  );
}
