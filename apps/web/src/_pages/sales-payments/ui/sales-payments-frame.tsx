import type { ReactNode } from "react";

import { AdminListHeader } from "@/shared/ui/admin";

export const salesPaymentsHeadingId = "sales-payments-heading";

/**
 * Каркас страницы «Платежи»: `main` маршрута, который оболочка админки делает областью прокрутки,
 * и заголовок списка. Готовый список, его скелет и состояния стоят в одном каркасе, поэтому приход
 * данных не сдвигает ни заголовок, ни начало таблицы.
 */
export function SalesPaymentsFrame({
  busy = false,
  children,
}: {
  readonly busy?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <main
      aria-busy={busy || undefined}
      aria-labelledby={salesPaymentsHeadingId}
      className="authoring-page"
      data-sales-payments-frame=""
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="authoring-page-body grid-cols-[minmax(0,1fr)] content-start">
        <AdminListHeader headingId={salesPaymentsHeadingId} title="Платежи" />
        <section
          aria-label="Список платежей"
          className="grid grid-cols-[minmax(0,1fr)] gap-4"
        >
          {children}
        </section>
      </div>
    </main>
  );
}
