import type { ReactNode } from "react";

/**
 * Рамка страницы «Оплата и права»: прокрутка и колонка для всех её разделов. Страница и истории
 * отдельных разделов берут её отсюда, поэтому раздел в Storybook стоит в той же колонке.
 */
export function BillingAdminFrame({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <main className="authoring-page" id="authoring-content" tabIndex={-1}>
      <div className="authoring-page-body">{children}</div>
    </main>
  );
}
