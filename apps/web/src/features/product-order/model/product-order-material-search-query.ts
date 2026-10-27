import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import type { CreateProductOrderMaterialSearchQueryOptions } from "./presentation";

import { searchProductOrderMaterials } from "../api/search-product-order-materials.browser";

export const productOrderMaterialSearchQueryOptions: CreateProductOrderMaterialSearchQueryOptions =
  ({ page, search }) =>
    queryOptions({
      placeholderData: keepPreviousData,
      queryFn: ({ signal }) =>
        searchProductOrderMaterials({ page, search, signal }),
      queryKey: ["product-order", "material-search", search, page] as const,
    });
