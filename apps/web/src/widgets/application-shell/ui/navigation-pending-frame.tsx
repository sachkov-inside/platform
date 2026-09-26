import type { ReactNode } from "react";

/** Рамка мгновенного экрана перехода из мобильной навигации: поверх страницы, док остаётся выше. */
export function NavigationPendingFrame({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-background px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 sm:px-7">
      <div className="mx-auto max-w-[61rem]">{children}</div>
    </div>
  );
}
