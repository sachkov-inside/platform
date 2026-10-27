import { overviewMetricIds } from "@/features/admin-overview";
import { AdminListHeader } from "@/shared/ui/admin";

import { AuthoringOverviewFrame } from "./authoring-overview-frame";

/**
 * Обзор, пока данные идут: настоящий заголовок, ряд карточек и место графика в своей геометрии.
 * Пришедший Обзор не сдвигает ни заголовок, ни начало карточек.
 */
export function AuthoringOverviewLoading() {
  return (
    <AuthoringOverviewFrame busy label="Загрузка обзора">
      <div className="admin-overview" data-authoring-overview>
        <AdminListHeader count="Загрузка…" title="Обзор" />
        <div aria-hidden="true" className="admin-overview-metrics">
          {overviewMetricIds.map((slot) => (
            <div className="admin-metric min-h-28" key={slot}>
              <span className="admin-skeleton-bar w-1/2" />
              <span className="admin-skeleton-bar mt-3 h-6 w-2/3" />
              <span className="admin-skeleton-bar mt-3 w-3/4" />
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="admin-overview-block min-h-72" />
      </div>
    </AuthoringOverviewFrame>
  );
}
