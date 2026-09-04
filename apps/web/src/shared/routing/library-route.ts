import type { Route } from "next";

const MAX_QUERY_LENGTH = 120;

export type LibraryRouteFormat = "guide" | "note" | "video";
export type LibraryRouteSort = "newest" | "relevance" | "title";

export interface LibraryRouteState {
  readonly formatSlug: LibraryRouteFormat | null;
  readonly q: string;
  readonly sort: LibraryRouteSort;
}

export function parseLibraryRouteSearch(
  search: URLSearchParams,
): LibraryRouteState {
  const q = normalizeLibraryQuery(search.getAll("q")[0]);
  return {
    formatSlug: normalizeLibraryFormat(search.getAll("format")[0]),
    q,
    sort: normalizeLibrarySort(search.getAll("sort")[0], q),
  };
}

export function serializeLibraryRouteSearch(
  state: LibraryRouteState,
): string {
  const search = new URLSearchParams();
  if (state.q.length > 0) search.set("q", state.q);
  if (state.formatSlug !== null) search.set("format", state.formatSlug);
  if (state.sort !== defaultLibraryRouteSort(state.q)) {
    search.set("sort", state.sort);
  }
  return search.toString();
}

export function libraryRouteHref(state: LibraryRouteState): Route {
  const search = serializeLibraryRouteSearch(state);
  return internalRoute(search.length === 0 ? "/library" : `/library?${search}`);
}

export function readCanonicalLibraryRouteHref(url: URL): Route | undefined {
  if (url.pathname !== "/library" || url.hash.length > 0) return undefined;
  const state = parseLibraryRouteSearch(url.searchParams);
  return url.searchParams.toString() === serializeLibraryRouteSearch(state)
    ? libraryRouteHref(state)
    : undefined;
}

export function defaultLibraryRouteSort(q: string): LibraryRouteSort {
  return q.length === 0 ? "newest" : "relevance";
}

function normalizeLibraryQuery(value: string | undefined): string {
  const truncated = (value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, MAX_QUERY_LENGTH);
  return /[\uD800-\uDBFF]$/u.test(truncated)
    ? truncated.slice(0, -1)
    : truncated;
}

function normalizeLibraryFormat(
  value: string | undefined,
): LibraryRouteFormat | null {
  return value === "guide" || value === "note" || value === "video"
    ? value
    : null;
}

function normalizeLibrarySort(
  value: string | undefined,
  q: string,
): LibraryRouteSort {
  return value === "newest" || value === "relevance" || value === "title"
    ? value
    : defaultLibraryRouteSort(q);
}

function isInternalRoute(value: string): value is Route {
  return value.startsWith("/") && !value.startsWith("//");
}

function internalRoute(value: string): Route {
  if (!isInternalRoute(value)) throw new TypeError("Expected an internal route");
  return value;
}
