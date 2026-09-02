import { queryOptions } from "@tanstack/react-query";

import { requestAuthoringMaterials } from "../api/authoring-materials.browser";
import type { AuthoringMaterialsQuery } from "./authoring-materials-presentation";
import { serializeAuthoringMaterialsQuery } from "./authoring-materials-query";

export function authoringMaterialsQueryKey(query?: AuthoringMaterialsQuery) {
  return query === undefined
    ? (["authoring", "materials"] as const)
    : ([
        "authoring",
        "materials",
        serializeAuthoringMaterialsQuery(query),
      ] as const);
}

export function authoringMaterialsQueryOptions(query: AuthoringMaterialsQuery) {
  return queryOptions({
    queryKey: authoringMaterialsQueryKey(query),
    queryFn: ({ signal }) => requestAuthoringMaterials(query, signal),
  });
}
