import { queryOptions } from "@tanstack/react-query";

import { requestAuthoringMaterialFilters } from "../api/authoring-material-filters.browser";

/**
 * Outside the `["authoring", "materials"]` prefix on purpose: a lifecycle write invalidates the
 * list, not the Topic and format choices.
 */
export const authoringMaterialFiltersQueryKey = [
  "authoring",
  "material-filter-options",
] as const;

export function authoringMaterialFiltersQueryOptions() {
  return queryOptions({
    queryKey: authoringMaterialFiltersQueryKey,
    queryFn: ({ signal }) => requestAuthoringMaterialFilters(signal),
  });
}
