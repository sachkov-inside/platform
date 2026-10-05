import type { ReactNode } from "react";

/**
 * Рамка страницы «Оплата и права»: колонка, в которой стоят все её разделы. Страница и истории
 * отдельных разделов берут её отсюда, поэтому раздел в Storybook стоит в той же колонке.
 */
export function BillingAdminFrame({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <div className="mx-auto grid max-w-4xl gap-6 pb-16">{children}</div>;
}
