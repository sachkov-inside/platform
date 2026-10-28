"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { peopleAccessReadsQueryKey } from "@/entities/authoring-person";
import {
  useAccessChangeRefresh,
  useAccessProductCatalog,
} from "@/features/product-access-actions";
import { useLiveSearchValue } from "@/shared/lib/use-live-search-value.client";
import { authoringPeopleHref } from "@/shared/routing/authoring";

import {
  parsePeopleListQuery,
  peopleListHref,
  searchParamsRecord,
  type PeopleListQuery,
} from "../model/people-list";
import { peopleListQueryOptions } from "../model/people-list-query-options";
import { AuthoringPeopleLoading } from "./authoring-people-loading";
import { AuthoringPeopleView } from "./authoring-people-view.client";

export function AuthoringPeoplePageQuery() {
  const searchParams = useSearchParams();
  return <PeopleQueryView locationSearch={searchParams.toString()} />;
}

function PeopleQueryView({
  locationSearch,
}: {
  readonly locationSearch: string;
}) {
  const query = useMemo(
    () => parseBrowserQuery(locationSearch),
    [locationSearch],
  );
  const debouncedSearch = useLiveSearchValue(query.search);
  // Адрес хранит введённый текст сразу; сервер видит его после паузы ввода, нормализованным.
  const requestQuery = useMemo(
    () =>
      parsePeopleListQuery({
        cursor: query.cursor,
        origin: query.origin,
        product: query.productId,
        q: debouncedSearch,
        state: query.state,
        telegram: query.telegram,
      }),
    [
      debouncedSearch,
      query.cursor,
      query.origin,
      query.productId,
      query.state,
      query.telegram,
    ],
  );
  const people = useQuery({
    ...peopleListQueryOptions(requestQuery),
    placeholderData: keepPreviousData,
  });
  const catalog = useAccessProductCatalog();
  // Выдача или отзыв в любой вкладке перечитывает список.
  useAccessChangeRefresh(peopleAccessReadsQueryKey);

  const changeQuery = useCallback(
    (next: PeopleListQuery) => {
      writePeopleUrl(next, query);
    },
    [query],
  );

  if (people.isPending) return <AuthoringPeopleLoading />;
  const state = people.data ?? {
    kind: "unavailable" as const,
    reference: "people-list-query",
  };
  return (
    <AuthoringPeopleView
      catalog={catalog}
      isRefreshing={people.isFetching}
      onQueryChange={changeQuery}
      onRetry={() => {
        void people.refetch();
      }}
      query={query}
      state={state}
    />
  );
}

/**
 * Записывает состояние списка в адрес. Выбор фильтра и страница добавляют запись истории, чтобы
 * «назад» вернул прежний выбор; ввод поиска заменяет запись, а не добавляет по одной на букву.
 */
function writePeopleUrl(next: PeopleListQuery, current: PeopleListQuery): void {
  // Ушедшая страница остаётся скрытой (ADR 0027); адрес переписывает только текущая.
  if (window.location.pathname !== authoringPeopleHref) return;
  const href = peopleListHref(next);
  if (`${window.location.pathname}${window.location.search}` === href) return;
  const onlySearchChanged =
    next.search !== current.search &&
    next.productId === current.productId &&
    next.origin === current.origin &&
    next.state === current.state &&
    next.telegram === current.telegram;
  if (onlySearchChanged) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
}

function parseBrowserQuery(locationSearch: string): PeopleListQuery {
  const params = new URLSearchParams(locationSearch);
  const query = parsePeopleListQuery(searchParamsRecord(params));
  const raw = params.get("q");
  // Поле показывает текст как введён, с пробелами; запрос нормализует его.
  return query.search === undefined || raw === null
    ? query
    : { ...query, search: raw };
}
