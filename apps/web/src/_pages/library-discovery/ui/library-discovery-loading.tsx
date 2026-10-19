import { ProductLandingSkeleton, pulse } from "./product-landing-skeletons";

import "./product-programme-view.css";

/**
 * Скелеты маршрутов продукта и программы (#670). Каждый собран из рамки своей страницы: та же
 * колонка, тот же ряд возврата и та же шапка, поэтому готовая страница встаёт на место скелета.
 * Высота скелета не меньше экрана: подвал ждёт за его краем и не прыгает, когда приходит страница.
 */

/** Программа: возврат к продукту, шапка с обложкой и строки уроков по главам. */
export function ProductProgrammeLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Программа загружается"
      className="programme-frame @container/programme mx-auto min-h-svh min-w-0 w-full max-w-[46rem]"
      data-route-skeleton="product-programme"
    >
      <div className="programme-sidebar" aria-hidden="true">
        <div className={`programme-sidebar-inner grid gap-2 ${pulse}`}>
          <div className="h-11 rounded-xl bg-muted" />
          <div className="h-11 rounded-xl bg-muted/65" />
        </div>
      </div>
      <div className="-mt-3 sm:mt-0 sm:pt-4" data-programme-part="back">
        <div className={`h-11 w-32 rounded-lg bg-muted ${pulse}`} />
      </div>
      <div
        className="mt-2 rounded-2xl bg-muted/60 p-4 sm:p-5"
        data-programme-part="header"
      >
        <div className={`flex items-center gap-4 ${pulse}`}>
          <div className="size-12 shrink-0 rounded-xl bg-muted" />
          <div className="min-w-0 flex-1">
            <div className="h-6 w-3/5 rounded-lg bg-muted sm:h-7" />
            <div className="mt-2 h-5 w-2/5 rounded-md bg-muted/80" />
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-6">
        {[3, 3].map((rows, chapter) => (
          <div key={chapter}>
            <div className={`h-7 w-4/5 rounded-md bg-muted ${pulse}`} />
            <div
              className={`my-3 flex min-h-11 items-center justify-between ${pulse}`}
            >
              <div className="h-4 w-32 rounded bg-muted/80" />
              <div className="h-3 w-10 rounded bg-muted/60" />
            </div>
            <div className="mt-3 grid gap-2">
              {Array.from({ length: rows }, (_, row) => (
                <div
                  className={`min-h-14 sm:min-h-16 rounded-xl bg-muted/65 ${pulse}`}
                  key={row}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={`mt-6 grid gap-6 ${pulse}`} aria-hidden="true">
        {[0, 1, 2].map((chapter) => (
          <div key={chapter} className="h-7 w-4/5 rounded-md bg-muted" />
        ))}
      </div>
      <p className="sr-only">Загружаем программу продукта</p>
    </div>
  );
}

/** The shared route fallback follows the current landing composition. */
export function ProductLandingLoading() {
  return <ProductLandingSkeleton />;
}
