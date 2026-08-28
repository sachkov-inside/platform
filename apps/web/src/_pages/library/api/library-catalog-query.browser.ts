import { createLibraryCatalogQueryOptions } from "../model/library-catalog-query";
import { requestLibraryCatalogPage } from "./request-library-catalog";

/** Same-origin browser adapter used after the server-hydrated first page. */
export function libraryCatalogBrowserQueryOptions(viewerScope: string) {
  return createLibraryCatalogQueryOptions(
    ({ after, signal }) => requestLibraryCatalogPage(after, signal),
    viewerScope,
  );
}
