"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  requestPeopleIdentities,
  requestPeopleSearch,
} from "../api/people-reads.browser";
import {
  PEOPLE_IDENTITIES_LIMIT,
  PEOPLE_SEARCH_LIMIT,
  peopleIdentitiesQueryKey,
  peopleSearchQueryKey,
  peopleSearchQuerySchema,
  type PeopleSearchState,
} from "./people-reads";
import type { PersonIdentity } from "./person-identity";

export type PeopleSearchView =
  { readonly kind: "idle" } | { readonly kind: "loading" } | PeopleSearchState;

/**
 * Поиск людей для владельца: по ID, точному email или имени и @username Telegram. Пустой или
 * слишком длинный запрос не отправляется (`idle`). Вызывающий сам откладывает ввод.
 */
export function usePeopleSearch(
  query: string,
  options: { readonly limit?: number } = {},
): PeopleSearchView {
  const text = peopleSearchQuerySchema.safeParse(query);
  const limit = Math.min(options.limit ?? 10, PEOPLE_SEARCH_LIMIT);
  const search = useQuery({
    queryKey: peopleSearchQueryKey(text.success ? text.data : "", limit),
    queryFn: ({ signal }) =>
      requestPeopleSearch({ text: text.data ?? "", limit }, signal),
    enabled: text.success,
  });
  if (!text.success) return { kind: "idle" };
  return search.data ?? { kind: "loading" };
}

export type PersonIdentitiesView =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      /** Только люди: ID посетителя или незнакомого аккаунта в ней отсутствует. */
      readonly byId: ReadonlyMap<string, PersonIdentity>;
    }
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable"; readonly reference: string };

/**
 * Подписи людей для колонки «Человек» чужого списка. Набор делится на чтения по 100 ID; пока
 * читается хоть одна часть, вид `loading`, а отказ или сбой любой части становится видом целиком.
 */
export function usePersonIdentities(
  accountIds: readonly string[],
): PersonIdentitiesView {
  const chunks = useMemo(() => {
    const unique = [
      ...new Set(accountIds.map((id) => id.toLowerCase())),
    ].sort();
    const parts: string[][] = [];
    for (let start = 0; start < unique.length; start += PEOPLE_IDENTITIES_LIMIT)
      parts.push(unique.slice(start, start + PEOPLE_IDENTITIES_LIMIT));
    return parts;
  }, [accountIds]);
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: peopleIdentitiesQueryKey(chunk),
      queryFn: ({ signal }: { readonly signal: AbortSignal }) =>
        requestPeopleIdentities(chunk, signal),
    })),
  });
  const byId = new Map<string, PersonIdentity>();
  for (const result of results) {
    const state = result.data;
    if (state === undefined) return { kind: "loading" };
    if (state.kind !== "ready") return state;
    for (const person of state.items) byId.set(person.accountId, person);
  }
  return { kind: "ready", byId };
}
