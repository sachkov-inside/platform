const FACET_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CURSOR = /^[A-Za-z0-9_-]+$/u;
const MAX_QUERY_LENGTH = 120;
const MAX_FACET_VALUES = 20;
const MAX_CURSOR_LENGTH = 512;

export type LibraryCatalogSort = "newest" | "relevance" | "series" | "title";

export interface LibrarySearchQuery {
  readonly after: string | null;
  readonly formatSlugs: readonly string[];
  readonly q: string;
  readonly seriesSlugs: readonly string[];
  readonly sort: LibraryCatalogSort;
  readonly topicSlugs: readonly string[];
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
): ParsedLibrarySearchParams {
  const raw = toSearchParams(input);
  const q = normalizeQuery(raw.getAll("q")[0]);
  const seriesSlugs = normalizeFacetValues(raw.getAll("series"));
  const query = {
    after: normalizeCursor(raw.getAll("after")[0]),
    formatSlugs: normalizeFacetValues(raw.getAll("format")),
    q,
    seriesSlugs,
    sort: normalizeSort(raw.getAll("sort")[0], q, seriesSlugs),
    topicSlugs: normalizeFacetValues(raw.getAll("topic")),
  } satisfies LibrarySearchQuery;
  return {
    query,
    wasNormalized: raw.toString() !== serializeLibrarySearchQuery(query),
  };
}

export function serializeLibrarySearchQuery(
  query: LibrarySearchQuery,
): string {
  const search = new URLSearchParams();
  if (query.q.length > 0) search.set("q", query.q);
  appendValues(search, "topic", query.topicSlugs);
  appendValues(search, "format", query.formatSlugs);
  appendValues(search, "series", query.seriesSlugs);
  if (query.sort !== defaultSort(query.q, query.seriesSlugs)) {
    search.set("sort", query.sort);
  }
  if (query.after !== null) search.set("after", query.after);
  return search.toString();
}

export function librarySearchQueryIdentity(query: LibrarySearchQuery): string {
  return serializeLibrarySearchQuery(query);
}

export function hasActiveLibrarySearch(query: LibrarySearchQuery): boolean {
  return (
    query.q.length > 0 ||
    query.topicSlugs.length > 0 ||
    query.formatSlugs.length > 0 ||
    query.seriesSlugs.length > 0
  );
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

function normalizeQuery(value: string | undefined): string {
  const truncated = (value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, MAX_QUERY_LENGTH);
  return /[\uD800-\uDBFF]$/u.test(truncated) ? truncated.slice(0, -1) : truncated;
}

function normalizeFacetValues(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => FACET_SLUG.test(value)))]
    .sort()
    .slice(0, MAX_FACET_VALUES);
}

function normalizeCursor(value: string | undefined): string | null {
  return value !== undefined &&
    value.length > 0 &&
    value.length <= MAX_CURSOR_LENGTH &&
    CURSOR.test(value)
    ? value
    : null;
}

function normalizeSort(
  value: string | undefined,
  q: string,
  seriesSlugs: readonly string[],
): LibraryCatalogSort {
  return value === "newest" ||
    value === "relevance" ||
    value === "title" ||
    (value === "series" && seriesSlugs.length === 1)
    ? value
    : defaultSort(q, seriesSlugs);
}

function defaultSort(q: string, seriesSlugs: readonly string[]): LibraryCatalogSort {
  return q.length === 0 && seriesSlugs.length === 1 ? "series" : "relevance";
}

function appendValues(
  search: URLSearchParams,
  name: string,
  values: readonly string[],
): void {
  for (const value of values) search.append(name, value);
}
