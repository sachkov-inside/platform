import { queryOptions } from "@tanstack/react-query";

import type { OverviewPeriodDays } from "@/features/admin-overview";

import { requestOverview } from "../api/overview.browser";
import { overviewQueryKey } from "./overview-report";

/** Единственная фабрика чтения Обзора: ключ зависит только от периода. */
export function overviewQueryOptions(period: OverviewPeriodDays) {
  return queryOptions({
    queryKey: overviewQueryKey(period),
    queryFn: ({ signal }) => requestOverview(period, signal),
  });
}
