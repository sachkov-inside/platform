import { queryOptions } from "@tanstack/react-query";

import { requestProductOverview } from "../api/product-overview.browser";
import type { OverviewPeriodDays } from "./overview-contract";
import { productOverviewQueryKey } from "./product-overview";

/** Единственная фабрика чтения Обзора продукта. */
export function productOverviewQueryOptions(
  productId: string,
  period: OverviewPeriodDays,
) {
  return queryOptions({
    queryKey: productOverviewQueryKey(productId, period),
    queryFn: ({ signal }) => requestProductOverview(productId, period, signal),
  });
}
