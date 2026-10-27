"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { useLiveSearchValue } from "@/shared/lib/use-live-search-value.client";

import { authoringMaterialFiltersQueryOptions } from "../model/authoring-material-filters-query-options";
import type {
  AuthoringMaterialFilterOptions,
  AuthoringMaterialsQuery,
} from "../model/authoring-materials-presentation";
import { authoringMaterialsQueryOptions } from "../model/authoring-materials-query-options";
import {
  authoringMaterialsHref,
  authoringMaterialsRootHref,
  parseAuthoringMaterialsQuery,
  parseAuthoringMaterialsUrlSearchParams,
} from "../model/authoring-materials-query";
import { AuthoringMaterialsLoading } from "./authoring-materials-loading";
import { AuthoringMaterialsView } from "./authoring-materials-view.client";

export function AuthoringMaterialsPageQuery() {
  const searchParams = useSearchParams();
  return (
    <AuthoringMaterialsQueryView locationSearch={searchParams.toString()} />
  );
}

function AuthoringMaterialsQueryView({
  locationSearch,
}: {
  readonly locationSearch: string;
}) {
  const query = useMemo(
    () => parseBrowserAuthoringMaterialsQuery(locationSearch),
    [locationSearch],
  );
  const debouncedSearch = useLiveSearchValue(query.search);
  // The address keeps the typed search at once; the server sees it once typing pauses, normalised
  // the same way the list route parses it.
  const requestQuery = useMemo(
    () =>
      parseAuthoringMaterialsQuery({
        format: query.format,
        page: String(query.page),
        search: debouncedSearch,
        state: query.publicationState,
        topic: query.topicId,
      }),
    [
      debouncedSearch,
      query.format,
      query.page,
      query.publicationState,
      query.topicId,
    ],
  );
  const materials = useQuery({
    ...authoringMaterialsQueryOptions(requestQuery),
    placeholderData: keepPreviousData,
  });
  const filters = useQuery(authoringMaterialFiltersQueryOptions());
  const filterOptions: AuthoringMaterialFilterOptions =
    filters.data ??
    (filters.isPending ? { kind: "pending" } : { kind: "unavailable" });

  const changeQuery = useCallback((next: AuthoringMaterialsQuery) => {
    replaceAuthoringMaterialsUrl(next);
  }, []);

  if (materials.isPending) return <AuthoringMaterialsLoading />;
  const state = materials.data ?? {
    kind: "unexpected_error" as const,
    reference: "authoring-materials-query",
  };

  return (
    <AuthoringMaterialsView
      filterOptions={filterOptions}
      isRefreshing={materials.isFetching}
      onQueryChange={changeQuery}
      onRetry={() => {
        void materials.refetch();
      }}
      query={query}
      state={state}
    />
  );
}

function replaceAuthoringMaterialsUrl(query: AuthoringMaterialsQuery): void {
  // Next keeps a visited list mounted but hidden while another page is open (ADR 0027); only the
  // list that is the current page may rewrite the address.
  if (window.location.pathname !== authoringMaterialsRootHref) return;
  const href = authoringMaterialsHref(query);
  if (`${window.location.pathname}${window.location.search}` !== href) {
    window.history.replaceState(null, "", href);
  }
}

function parseBrowserAuthoringMaterialsQuery(
  locationSearch: string,
): AuthoringMaterialsQuery {
  const searchParams = new URLSearchParams(locationSearch);
  const query = parseAuthoringMaterialsUrlSearchParams(searchParams);
  const rawSearch = searchParams.get("search");
  // The field shows the search as typed, spaces included; the request normalises it.
  return query.search === undefined || rawSearch === null
    ? query
    : { ...query, search: rawSearch };
}
