import type { ReactNode } from "react";

/**
 * Каркас отчёта: `main` маршрута, который оболочка админки делает областью прокрутки. Готовый
 * отчёт и состояния отказа стоят в одном каркасе, поэтому приход данных не меняет отступов.
 */
export function SalesFunnelReportFrame({
  children,
  labelledBy,
}: {
  readonly children: ReactNode;
  readonly labelledBy?: string;
}) {
  return (
    <main
      aria-label={labelledBy === undefined ? "Воронка продаж" : undefined}
      aria-labelledby={labelledBy}
      className="authoring-page"
      data-sales-funnel-report
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="authoring-page-body grid-cols-[minmax(0,1fr)] content-start">
        {children}
      </div>
    </main>
  );
}
