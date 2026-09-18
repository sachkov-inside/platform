import { Suspense } from "react";

import { GuideProductSkeleton, pulse } from "./guide-product-skeletons";
import { ProductSkeletonBySlug } from "./product-skeleton-by-slug.client";

/**
 * Скелеты маршрутов продукта и программы (#670). Каждый собран из рамки своей страницы: та же
 * колонка, тот же ряд возврата и та же шапка, поэтому готовая страница встаёт на место скелета.
 * Высота скелета не меньше экрана: подвал ждёт за его краем и не прыгает, когда приходит страница.
 * Общий скелет подборки остался у темы.
 */


/** Программа: возврат к продукту, шапка с обложкой и строки уроков по главам. */
export function GuideProgrammeLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Программа загружается"
      className="@container/programme mx-auto min-h-svh min-w-0 w-full max-w-[46rem]"
      data-route-skeleton="guide-programme"
    >
      <div className="pt-4" data-programme-part="back">
        <div className={`h-11 w-32 rounded-lg bg-muted ${pulse}`} />
      </div>
      <div className="mt-2 rounded-2xl bg-muted/60 p-4 sm:p-5" data-programme-part="header">
        <div className={`flex items-center gap-4 ${pulse}`}>
          <div className="aspect-square w-16 shrink-0 rounded-lg bg-muted sm:w-20" />
          <div className="min-w-0 flex-1">
            <div className="h-6 w-3/5 rounded-lg bg-muted sm:h-7" />
            <div className="mt-2 h-5 w-2/5 rounded-md bg-muted/80" />
          </div>
        </div>
      </div>
      <div className="mt-5 min-h-11 border-b border-border" />
      <div className="mt-5 grid gap-6">
        {[3, 3].map((rows, chapter) => (
          <div key={chapter}>
            <div className={`h-7 w-1/2 rounded-md bg-muted ${pulse}`} />
            <div className="mt-3 grid gap-2">
              {Array.from({ length: rows }, (_, row) => (
                <div className={`min-h-24 rounded-xl bg-muted/65 ${pulse}`} key={row} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="sr-only">Загружаем программу продукта</p>
    </div>
  );
}

/**
 * Страница продукта. Практикум AI-first свёрстан иначе, чем остальные продукты, поэтому при
 * переходе скелет выбирается по адресу: его знает клиентский роутер, но не общая оболочка
 * маршрута. В ней и при прямом заходе стоит скелет обычного продукта.
 */
export function GuideProductLoading() {
  return (
    <Suspense fallback={<GuideProductSkeleton />}>
      <ProductSkeletonBySlug />
    </Suspense>
  );
}
