import type { ReactNode } from "react";

/**
 * Каркас Обзора: `main` маршрута, который оболочка админки прокручивает, и отступы страницы.
 * Готовый Обзор, его загрузка и ошибки стоят в одном каркасе, поэтому приход данных не сдвигает
 * заголовок.
 */
export function AuthoringOverviewFrame({
  busy = false,
  children,
  label,
  labelledBy,
}: {
  readonly busy?: boolean;
  readonly children: ReactNode;
  readonly label?: string;
  readonly labelledBy?: string;
}) {
  return (
    <main
      aria-busy={busy || undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      className="authoring-page"
      data-authoring-overview-frame
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="authoring-page-body grid-cols-[minmax(0,1fr)] content-start">
        {children}
      </div>
    </main>
  );
}
