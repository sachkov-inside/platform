import { queryOptions } from "@tanstack/react-query";

import { requestProductHolders } from "../api/product-holders.browser";
import {
  productHoldersSearch,
  type ProductHoldersQuery,
} from "./product-holders";

/** Every holders read of one Product shares this prefix: a grant invalidates all of them. */
export function productHoldersQueryKey(productId: string) {
  return ["authoring", "product-holders", productId] as const;
}

/** The one query factory of the holders read: list pages and the grant pre-check. */
export function productHoldersQueryOptions(query: ProductHoldersQuery) {
  return queryOptions({
    queryKey: [
      ...productHoldersQueryKey(query.productId),
      productHoldersSearch(query),
    ] as const,
    queryFn: ({ signal }) => requestProductHolders(query, signal),
  });
}
