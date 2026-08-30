import "server-only";

import { createLibraryCatalogQueryOptions } from "../model/library-catalog-query";
import { getLibraryCatalogPage } from "./get-library-catalog";
import type { LibrarySearchQuery } from "../model/library-search-query";

/** Direct server-to-Nest adapter used only while rendering the RSC route. */
export function libraryCatalogServerQueryOptions(
  viewerScope: string,
  query: LibrarySearchQuery,
  accessToken?: string,
) {
  return createLibraryCatalogQueryOptions(
    ({ after, signal }) =>
      getLibraryCatalogPage(query, after, accessToken, signal),
    viewerScope,
    query,
  );
}
