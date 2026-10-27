/**
 * Общие модули админки (#1717): таблица списка, фильтры, плашки, показатели, график, диалог с
 * причиной, состояния списка, постраничный вывод и поля суммы и даты. Вход безопасен для
 * клиента: интерактивные модули объявляют `"use client"` сами, остальные рендерятся где угодно.
 */
export {
  AdminConfirmDialog,
  AdminDialog,
  AdminDialogError,
} from "./admin-dialog.client";
export type {
  AdminConfirmDialogProps,
  AdminDialogProps,
} from "./admin-dialog.client";
export { AdminFilterBar } from "./admin-filter-bar.client";
export type {
  AdminFilterBarProps,
  AdminFilterChip,
  AdminFilterSearch,
  AdminSelectFilter,
} from "./admin-filter-bar.client";
export { AdminListHeader } from "./admin-list-header";
export {
  AdminCursorPagination,
  AdminPagination,
} from "./admin-pagination.client";
export { AdminRowMenu } from "./admin-row-menu.client";
export {
  AdminSearchChecklist,
  AdminSearchSelect,
} from "./admin-search-select.client";
export type { AdminChoice } from "./admin-search-select.client";
export type { AdminRowMenuItem } from "./admin-row-menu.client";
export {
  AdminEmptyState,
  AdminErrorState,
  AdminFilterBarSkeleton,
  AdminNoResults,
  AdminNotFound,
  AdminTableSkeleton,
} from "./admin-states";
export { AdminTable } from "./admin-table.client";
export type {
  AdminTableColumn,
  AdminTableMobileItem,
  AdminTableProps,
} from "./admin-table.client";
export { AmountField } from "./amount-field.client";
export type { AmountFieldProps } from "./amount-field.client";
export { DateField } from "./date-field.client";
export type { DateFieldProps } from "./date-field.client";
export { MetricCard } from "./metric-card.client";
export type { MetricCardProps, MetricChange } from "./metric-card.client";
export { ReasonDialog } from "./reason-dialog.client";
export type { ReasonDialogProps, ReasonOption } from "./reason-dialog.client";
export { StateBadge, adminStates } from "./state-badge";
export type {
  AdminStateDefinition,
  AdminStateKey,
  AdminStateTone,
} from "./state-badge";
export { TrendChart } from "./trend-chart.client";
export type { TrendChartProps, TrendPoint } from "./trend-chart.client";
