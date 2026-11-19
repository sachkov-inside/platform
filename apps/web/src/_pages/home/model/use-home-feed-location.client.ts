"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import {
  libraryHref,
  parseLibrarySearchParams,
  withoutLibraryCursor,
  type LibrarySearchQuery,
} from "@/features/library-catalog";

export function useHomeFeedLocation() {
  const search = useSearchParams().toString();
  // Поиска на Главной нет (решение владельца 09.10.2026): текст запроса из старой ссылки
  // `/?q=…` не применяется, иначе лента сузилась бы без видимой причины. Синхронизация адреса
  // ниже убирает его из адреса.
  const initialQuery = useMemo(() => {
    const query = withoutLibraryCursor(
      parseLibrarySearchParams(new URLSearchParams(search)).query,
    );
    return {
      ...query,
      q: "",
      formatSlugs: [],
      sort: query.sort === "relevance" ? ("newest" as const) : query.sort,
    };
  }, [search]);
  useEffect(() => {
    replaceHomeQuery(initialQuery);
  }, [initialQuery]);
  return initialQuery;
}

export function replaceHomeQuery(query: LibrarySearchQuery) {
  const destination = new URL(libraryHref(query), window.location.origin);
  for (const value of new URLSearchParams(window.location.search).getAll(
    "authentication",
  ))
    destination.searchParams.append("authentication", value);
  const href = `${destination.pathname}${destination.search}`;
  if (`${window.location.pathname}${window.location.search}` !== href)
    window.history.replaceState(null, "", href);
}
