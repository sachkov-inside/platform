import type { Metadata } from "next";
import { connection } from "next/server";
import { createHash } from "node:crypto";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { libraryCatalogServerQueryOptions } from "@/_pages/library.server";
import { LibraryPageQuery } from "@/_pages/library";
import { getQueryClient } from "@/shared/api/query-client";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export const metadata: Metadata = {
  title: "Библиотека",
};

export default async function Page() {
  await connection();
  const queryClient = getQueryClient();
  const accessToken = await getOptionalPlatformAccessToken();
  const viewerScope =
    accessToken === undefined
      ? "anonymous"
      : `authenticated:${createHash("sha256").update(accessToken).digest("base64url")}`;
  await queryClient.infiniteQuery(
    libraryCatalogServerQueryOptions(viewerScope, accessToken),
  );

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LibraryPageQuery viewerScope={viewerScope} />
    </HydrationBoundary>
  );
}
