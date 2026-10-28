"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { authoringProductsHref } from "@/shared/routing/authoring";
import { Button } from "@/shared/ui/button";

/**
 * Верхняя строка страницы продукта: возврат ко всем продуктам и состояние страницы справа.
 * Возврат сделан обычной ссылкой, поэтому он работает и до гидратации. Пока на странице есть
 * несохранённые правки или загрузки, переход по ссылке задерживает общий охранник автосохранения
 * (`useAutosave`): он сначала сохраняет правки.
 */
export function ProductPageNavigation({
  children,
}: {
  readonly children?: ReactNode;
}) {
  return (
    <nav
      aria-label="Навигация продукта"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4"
    >
      <Button asChild variant="ghost">
        <Link href={authoringProductsHref}>
          <ArrowLeft aria-hidden="true" />
          Все продукты
        </Link>
      </Button>
      {children}
    </nav>
  );
}
