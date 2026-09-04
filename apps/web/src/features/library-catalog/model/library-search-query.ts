import type { Route } from "next";

import {
  defaultLibraryRouteSort,
  libraryRouteHref,
  parseLibraryRouteSearch,
  serializeLibraryRouteSearch,
  type LibraryRouteFormat,
  type LibraryRouteSort,
} from "@/shared/routing/library-route";

const CURSOR = /^[A-Za-z0-9_-]+$/u;
const MAX_CURSOR_LENGTH = 512;

export type LibraryCatalogSort = LibraryRouteSort;

export interface LibrarySearchQuery {
  readonly after: string | null;
  readonly formatSlugs: readonly LibraryRouteFormat[];
  readonly q: string;
  readonly sort: LibraryCatalogSort;
}

export interface ParsedLibrarySearchParams {
  readonly query: LibrarySearchQuery;
  readonly wasNormalized: boolean;
}

type SearchParamsInput =
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export function parseLibrarySearchParams(
  input: SearchParamsInput,
  options: { readonly includeCursor?: boolean } = {},
): ParsedLibrarySearchParams {
  const raw = toSearchParams(input);
  const route = parseLibraryRouteSearch(raw);
  const query = {
    after: normalizeCursor(raw.getAll("after")[0]),
    formatSlugs: route.formatSlug === null ? [] : [route.formatSlug],
    q: route.q,
    sort: route.sort,
  } satisfies LibrarySearchQuery;
  return {
    query,
    wasNormalized:
      raw.toString() !==
      serializeLibrarySearchQuery(query, {
        includeCursor: options.includeCursor ?? false,
      }),
  };
}

export function serializeLibrarySearchQuery(
  query: LibrarySearchQuery,
  options: { readonly includeCursor?: boolean } = {},
): string {
  const search = new URLSearchParams(
    serializeLibraryRouteSearch({
      formatSlug: query.formatSlugs[0] ?? null,
      q: query.q,
      sort: query.sort,
    }),
  );
  if (options.includeCursor === true && query.after !== null) {
    search.set("after", query.after);
  }
  return search.toString();
}

export function librarySearchQueryIdentity(query: LibrarySearchQuery): string {
  return serializeLibrarySearchQuery(query);
}

export function libraryHref(query: LibrarySearchQuery): Route {
  return libraryRouteHref({
    formatSlug: query.formatSlugs[0] ?? null,
    q: query.q,
    sort: query.sort,
  });
}

export function hasActiveLibrarySearch(query: LibrarySearchQuery): boolean {
  return (
    query.q.length > 0 ||
    query.formatSlugs.length > 0 ||
    query.sort !== defaultLibraryRouteSort(query.q)
  );
}

export function withoutLibraryCursor(
  query: LibrarySearchQuery,
): LibrarySearchQuery {
  return { ...query, after: null };
}

export function changeLibraryQuery(
  query: LibrarySearchQuery,
  patch: Partial<LibrarySearchQuery>,
): LibrarySearchQuery {
  const search = serializeLibrarySearchQuery({
    ...query,
    ...patch,
    after: null,
  });
  return parseLibrarySearchParams(new URLSearchParams(search)).query;
}

function toSearchParams(input: SearchParamsInput): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue;
    for (const item of typeof value === "string" ? [value] : value) {
      search.append(name, item);
    }
  }
  return search;
}

function normalizeCursor(value: string | undefined): string | null {
  return value !== undefined &&
    value.length > 0 &&
    value.length <= MAX_CURSOR_LENGTH &&
    CURSOR.test(value)
    ? value
    : null;
}
