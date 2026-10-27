/**
 * Обзор админки (#1719): общие ряды показателей, изменение к прошлому периоду, лента событий и
 * вкладка «Обзор» страницы продукта. Вход безопасен для клиента.
 */
import "./ui/admin-overview.css";

export {
  defaultOverviewPeriod,
  newAccessMetricSchema,
  overviewByOriginSchema,
  overviewEventSchema,
  overviewMetricSchema,
  overviewPeriodDays,
  overviewPeriodSchema,
  overviewSeriesSchema,
  parseOverviewPeriod,
  type NewAccessMetric,
  type OverviewByOrigin,
  type OverviewEvent,
  type OverviewMetric,
  type OverviewOrigin,
  type OverviewPeriod,
  type OverviewPeriodDays,
  type OverviewSeries,
} from "./model/overview-contract";
export {
  defaultOverviewMetric,
  metricAmountText,
  metricChange,
  metricChartSummary,
  metricValueText,
  originBreakdown,
  overviewMetricIds,
  periodHasFacts,
  overviewMetrics,
  overviewOriginLabels,
  periodLabel,
  progressText,
  type OverviewMetricId,
} from "./model/metric-presentation";
export {
  eventPersonLabel,
  overviewEventRow,
  type OverviewEventRow,
} from "./model/event-presentation";
export {
  productOverviewPeriodSearch,
  readProductOverviewPeriod,
  type ProductOverview,
  type ProductOverviewState,
} from "./model/product-overview";
export { OverviewEventList } from "./ui/overview-event-list";
export { OriginBreakdown } from "./ui/origin-breakdown";
export { PeriodSwitch } from "./ui/period-switch.client";
export {
  ProductOverviewPanel,
  type ProductOverviewPanelProps,
} from "./ui/product-overview-panel.client";
export { ProductOverviewTab } from "./ui/product-overview-tab.client";
