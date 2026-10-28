import type { Route } from "next";

import {
  defaultOverviewMetric,
  defaultOverviewPeriod,
  overviewMetricIds,
  parseOverviewPeriod,
  type OverviewMetricId,
  type OverviewPeriodDays,
} from "@/features/admin-overview";
import { authoringOverviewHref } from "@/shared/routing/authoring";
import { internalRoute } from "@/shared/routing/internal-route";

/**
 * Состояние Обзора в адресе: период (`?period=7|90`, тридцать дней не пишутся) и показатель на
 * графике (`?metric=sales`, выручка не пишется). Ссылка и «назад» возвращают тот же вид.
 */
export interface OverviewQuery {
  readonly period: OverviewPeriodDays;
  readonly metric: OverviewMetricId;
}

function isMetricId(value: string | null): value is OverviewMetricId {
  return overviewMetricIds.some((id) => id === value);
}

/** Адрес → состояние; незнакомое значение открывает вид по умолчанию. */
export function parseOverviewQuery(params: URLSearchParams): OverviewQuery {
  const metric = params.get("metric");
  return {
    period: parseOverviewPeriod(params.get("period")),
    metric: isMetricId(metric) ? metric : defaultOverviewMetric,
  };
}

export function serializeOverviewQuery(query: OverviewQuery): string {
  const params = new URLSearchParams();
  if (query.period !== defaultOverviewPeriod)
    params.set("period", String(query.period));
  if (query.metric !== defaultOverviewMetric)
    params.set("metric", query.metric);
  return params.toString();
}

export function overviewQueryHref(query: OverviewQuery): Route {
  const search = serializeOverviewQuery(query);
  return search === ""
    ? authoringOverviewHref
    : internalRoute(`${authoringOverviewHref}?${search}`);
}
