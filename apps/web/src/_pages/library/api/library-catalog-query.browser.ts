import { createLibraryCatalogQueryOptions } from "../model/library-catalog-query";
import { requestLibraryCatalogPage } from "./request-library-catalog";
import type { LibrarySearchQuery } from "../model/library-search-query";

/** Same-origin browser adapter used after the server-hydrated first page. */
export function libraryCatalogBrowserQueryOptions(
  viewerScope: string,
  query: LibrarySearchQuery,
) {
  return createLibraryCatalogQueryOptions(
    ({ after, signal }) => requestLibraryCatalogPage(query, after, signal),
    viewerScope,
    query,
  );
}
