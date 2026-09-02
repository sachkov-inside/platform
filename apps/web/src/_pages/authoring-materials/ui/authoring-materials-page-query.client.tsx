"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useMemo,
} from "react";

import { useLiveSearchValue } from "@/shared/lib/use-live-search-value.client";

import type { AuthoringMaterialsQuery } from "../model/authoring-materials-presentation";
import { authoringMaterialsQueryOptions } from "../model/authoring-materials-query-options";
import {
  parseAuthoringMaterialsQuery,
  parseAuthoringMaterialsUrlSearchParams,
  authoringMaterialsRootHref,
  serializeAuthoringMaterialsQuery,
} from "../model/authoring-materials-query";
import {
  AuthoringMaterialsLoading,
  AuthoringMaterialsView,
} from "./authoring-materials-view";

export function AuthoringMaterialsPageQuery() {
  const searchParams = useSearchParams();
  return <AuthoringMaterialsQueryView locationSearch={searchParams.toString()} />;
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
  const requestQuery = useMemo(
    () =>
      parseAuthoringMaterialsQuery({
        page: String(query.page),
        ...(query.publicationState === undefined
          ? {}
          : { state: query.publicationState }),
        ...(debouncedSearch === undefined
          ? {}
          : { search: debouncedSearch }),
      }),
    [debouncedSearch, query.page, query.publicationState],
  );
  const materials = useQuery({
    ...authoringMaterialsQueryOptions(requestQuery),
    placeholderData: keepPreviousData,
  });

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
  const search = serializeAuthoringMaterialsQuery(query);
  const href =
    search === ""
      ? authoringMaterialsRootHref
      : `${authoringMaterialsRootHref}?${search}`;
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
  return query.search === undefined || rawSearch === null
    ? query
    : { ...query, search: rawSearch };
}
