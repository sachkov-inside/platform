"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { authoringOverviewHref } from "@/shared/routing/authoring";

import {
  overviewQueryHref,
  parseOverviewQuery,
  type OverviewQuery,
} from "../model/overview-query";
import { overviewQueryOptions } from "../model/overview-query-options";
import { AuthoringOverviewLoading } from "./authoring-overview-loading";
import { AuthoringOverviewView } from "./authoring-overview-view.client";

export function AuthoringOverviewPageQuery() {
  const locationSearch = useSearchParams().toString();
  const query = useMemo(
    () => parseOverviewQuery(new URLSearchParams(locationSearch)),
    [locationSearch],
  );
  const overview = useQuery({
    ...overviewQueryOptions(query.period),
    placeholderData: keepPreviousData,
  });
  const changeQuery = useCallback((next: OverviewQuery) => {
    writeOverviewUrl(next);
  }, []);

  if (overview.isPending) return <AuthoringOverviewLoading />;
  return (
    <AuthoringOverviewView
      onQueryChange={changeQuery}
      onRetry={() => {
        void overview.refetch();
      }}
      query={query}
      refreshing={overview.isPlaceholderData}
      state={
        overview.data ?? { kind: "unavailable", reference: "overview-query" }
      }
    />
  );
}

/**
 * Период и показатель графика записываются в адрес новой записью истории, поэтому «назад»
 * возвращает прежний вид. Скрытая страница (ADR 0027) адрес не трогает.
 */
function writeOverviewUrl(next: OverviewQuery): void {
  if (window.location.pathname !== authoringOverviewHref) return;
  const href = overviewQueryHref(next);
  if (`${window.location.pathname}${window.location.search}` === href) return;
  window.history.pushState(null, "", href);
}
