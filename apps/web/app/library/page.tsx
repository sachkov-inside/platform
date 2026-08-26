import type { Metadata } from "next";
import { connection } from "next/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { libraryCatalogServerQueryOptions } from "@/_pages/library.server";
import { LibraryPageQuery } from "@/_pages/library";
import { getQueryClient } from "@/shared/api/query-client";

export const metadata: Metadata = {
  title: "Библиотека",
};

export default async function Page() {
  await connection();
  const queryClient = getQueryClient();
  await queryClient.infiniteQuery(libraryCatalogServerQueryOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LibraryPageQuery />
    </HydrationBoundary>
  );
}
