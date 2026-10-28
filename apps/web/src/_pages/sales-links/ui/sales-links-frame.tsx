import type { ReactNode } from "react";

/** Каркас страницы «Ссылки на оплату»: `main` маршрута и отступы, общие у списка и его скелета. */
export function SalesLinksFrame({
  busy = false,
  children,
}: {
  readonly busy?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <main
      aria-busy={busy || undefined}
      aria-labelledby={busy ? undefined : "payment-links-heading"}
      aria-label={busy ? "Загрузка ссылок на оплату" : undefined}
      className="authoring-page"
      data-sales-links
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="authoring-page-body grid-cols-[minmax(0,1fr)] content-start">
        {children}
      </div>
    </main>
  );
}
