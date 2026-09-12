import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./broadcasts.module.css";

/**
 * Рамка страницы рассылок: прокручиваемое содержимое маршрута, возврат к воронкам и сетка
 * разделов. Приложение и Storybook берут её отсюда, поэтому панели видны в том же кадре, что и
 * на `/authoring/communications/broadcasts`.
 */
export function BroadcastsPageFrame({ children }: { readonly children: ReactNode }) {
  return (
    <main
      id="authoring-content"
      tabIndex={-1}
      className="h-full overflow-y-auto bg-background px-4 pb-24 pt-5 text-foreground sm:px-6"
    >
      <div className={styles.page}>
        <Link
          className="flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          href="/authoring/communications"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Воронки Telegram
        </Link>
        {children}
      </div>
    </main>
  );
}
