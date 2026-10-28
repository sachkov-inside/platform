import type { ReactNode } from "react";

/** Каркас страницы «Скидки»: `main` маршрута и отступы, общие у списка и его скелета. */
export function SalesDiscountsFrame({
  busy = false,
  children,
}: {
  readonly busy?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <main
      aria-busy={busy || undefined}
      aria-label={busy ? "Загрузка скидок" : undefined}
      aria-labelledby={busy ? undefined : "promotions-heading"}
      className="authoring-page"
      data-sales-discounts
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="authoring-page-body grid-cols-[minmax(0,1fr)] content-start">
        {children}
      </div>
    </main>
  );
}
