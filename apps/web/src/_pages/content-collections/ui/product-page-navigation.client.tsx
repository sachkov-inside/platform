"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";
import { Button } from "@/shared/ui/button";

/**
 * Верхняя строка страницы продукта: возврат ко всем продуктам и состояние страницы справа.
 * Возврат срабатывает, только когда на странице не осталось несохранённых правок и загрузок.
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
      <Button
        onClick={() => {
          void flushPendingEdits().then((ok) => {
            if (ok) router.push("/authoring/products");
          });
        }}
        type="button"
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" />
        Все продукты
      </Button>
      {children}
    </nav>
  );
}
