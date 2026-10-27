"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";
import { authoringProductsHref } from "@/shared/routing/authoring";
import { Button } from "@/shared/ui/button";

/**
 * Верхняя строка страницы продукта: возврат ко всем продуктам и состояние страницы справа.
 * Возврат срабатывает, только когда на странице не осталось несохранённых правок и загрузок.
 * Это ссылка: до гидратации она ведёт по адресу сама (правок ещё нет), а после гидратации
 * обычное нажатие сначала дожидается сохранения правок.
 */
export function ProductPageNavigation({
  children,
}: {
  readonly children?: ReactNode;
}) {
  const router = useRouter();
  return (
    <nav
      aria-label="Навигация продукта"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4"
    >
      <Button asChild variant="ghost">
        <Link
          href={authoringProductsHref}
          onClick={(event) => {
            // Новая вкладка или окно: эта страница остаётся открытой со своими правками.
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            void flushPendingEdits().then((ok) => {
              if (ok) router.push(authoringProductsHref);
            });
          }}
        >
          <ArrowLeft aria-hidden="true" />
          Все продукты
        </Link>
      </Button>
      {children}
    </nav>
  );
}
