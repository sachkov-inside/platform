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
    <main
      className="h-full min-h-svh overflow-y-auto md:min-h-0"
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="mx-auto grid max-w-4xl gap-6 pb-16">{children}</div>
    </main>
  );
}
