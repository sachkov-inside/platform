import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import type { CreateSeriesOrderMaterialSearchQueryOptions } from "./presentation";

import { searchSeriesOrderMaterials } from "../api/search-series-order-materials.browser";

export const seriesOrderMaterialSearchQueryOptions: CreateSeriesOrderMaterialSearchQueryOptions =
  ({ page, search }) =>
    queryOptions({
      placeholderData: keepPreviousData,
      queryFn: ({ signal }) =>
        searchSeriesOrderMaterials({ page, search, signal }),
      queryKey: ["series-order", "material-search", search, page] as const,
    });
