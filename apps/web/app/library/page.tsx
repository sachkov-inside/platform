import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import {
  libraryCatalogServerQueryOptions,
  LibraryQueryRejectedError,
} from "@/_pages/library.server";
import {
  LibraryPageQuery,
  parseLibrarySearchParams,
  serializeLibrarySearchQuery,
} from "@/_pages/library";
import { getQueryClient } from "@/shared/api/query-client";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export const metadata: Metadata = {
  title: "Библиотека",
};

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >;
}) {
  await connection();
  const parsedSearch = parseLibrarySearchParams(await searchParams);
  if (parsedSearch.wasNormalized) {
    redirectToLibraryQuery(parsedSearch.query);
  }
  const queryClient = getQueryClient();
  const accessToken = await getOptionalPlatformAccessToken();
  const viewerScope =
    accessToken === undefined
      ? "anonymous"
      : `authenticated:${createHash("sha256").update(accessToken).digest("base64url")}`;
  const catalog = await queryClient
    .infiniteQuery(
      libraryCatalogServerQueryOptions(
        viewerScope,
        parsedSearch.query,
        accessToken,
      ),
    )
    .catch((error: unknown) => {
      if (
        error instanceof LibraryQueryRejectedError &&
        parsedSearch.query.after !== null
      ) {
        redirectToLibraryQuery({ ...parsedSearch.query, after: null });
      }
      throw error;
    });
  const firstPage = catalog.pages[0];
  if (firstPage?.kind === "ready") {
    const known = {
      ...parsedSearch.query,
      formatSlugs: keepKnownSlugs(
        parsedSearch.query.formatSlugs,
        firstPage.facets.formats,
      ),
      seriesSlugs: keepKnownSlugs(
        parsedSearch.query.seriesSlugs,
        firstPage.facets.series,
      ),
      topicSlugs: keepKnownSlugs(
        parsedSearch.query.topicSlugs,
        firstPage.facets.topics,
      ),
    };
    if (
      serializeLibrarySearchQuery(known) !==
      serializeLibrarySearchQuery(parsedSearch.query)
    ) {
      redirectToLibraryQuery(known);
    }
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LibraryPageQuery query={parsedSearch.query} viewerScope={viewerScope} />
    </HydrationBoundary>
  );
}

function keepKnownSlugs(
  selected: readonly string[],
  options: readonly { readonly slug: string }[],
): readonly string[] {
  const known = new Set(options.map(({ slug }) => slug));
  return selected.filter((slug) => known.has(slug));
}

function redirectToLibraryQuery(
  query: Parameters<typeof serializeLibrarySearchQuery>[0],
): never {
  const search = serializeLibrarySearchQuery(query);
  redirect(search.length === 0 ? "/library" : `/library?${search}`);
}
