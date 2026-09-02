"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

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

const SEARCH_DEBOUNCE_MS = 250;

export function AuthoringMaterialsPageQuery({
  initialQuery,
}: {
  readonly initialQuery: AuthoringMaterialsQuery;
}) {
  return <AuthoringMaterialsQueryView initialQuery={initialQuery} />;
}

function AuthoringMaterialsQueryView({
  initialQuery,
}: {
  readonly initialQuery: AuthoringMaterialsQuery;
}) {
  const [query, setQuery] = useState(initialQuery);
  const debouncedSearch = useDebouncedValue(
    query.search,
    SEARCH_DEBOUNCE_MS,
  );
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
    enabled: typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    replaceAuthoringMaterialsUrl(requestQuery);
  }, [requestQuery]);

  useEffect(() => {
    const restoreQuery = () => {
      setQuery(
        parseAuthoringMaterialsUrlSearchParams(
          new URLSearchParams(window.location.search),
        ),
      );
    };
    window.addEventListener("popstate", restoreQuery);
    return () => {
      window.removeEventListener("popstate", restoreQuery);
    };
  }, []);

  const changeQuery = useCallback((next: AuthoringMaterialsQuery) => {
    setQuery(next);
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

function useDebouncedValue<Value>(value: Value, delay: number): Value {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [delay, value]);
  return debounced;
}
