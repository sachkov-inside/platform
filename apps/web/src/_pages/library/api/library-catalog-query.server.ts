import "server-only";

import { createLibraryCatalogQueryOptions } from "../model/library-catalog-query";
import { getLibraryCatalogPage } from "./get-library-catalog";

/** Direct server-to-Nest adapter used only while rendering the RSC route. */
export function libraryCatalogServerQueryOptions() {
  return createLibraryCatalogQueryOptions(({ after, signal }) =>
    getLibraryCatalogPage(after, signal),
  );
}
