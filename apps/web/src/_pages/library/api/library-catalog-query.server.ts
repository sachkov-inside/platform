import "server-only";

import { createLibraryCatalogQueryOptions } from "../model/library-catalog-query";
import { getLibraryCatalogPage } from "./get-library-catalog";

/** Direct server-to-Nest adapter used only while rendering the RSC route. */
export function libraryCatalogServerQueryOptions(
  viewerScope: string,
  accessToken?: string,
) {
  return createLibraryCatalogQueryOptions(
    ({ after, signal }) => getLibraryCatalogPage(after, accessToken, signal),
    viewerScope,
  );
}
