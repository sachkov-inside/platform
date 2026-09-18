/** Скелеты страницы продукта: их рисуют и общая оболочка маршрута, и клиентский выбор по адресу. */

/** Пульсация серых блоков; при `prefers-reduced-motion` они стоят неподвижно. */
export const pulse = "animate-pulse motion-reduce:animate-none";

/** Обычный продукт: возврат, тёмная шапка с обложкой 16:9, заголовок и разделы. */
export function GuideProductSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Продукт загружается"
      className="min-h-svh min-w-0"
      data-route-skeleton="guide-product"
    >
      <div className="mx-auto w-full min-w-0 max-w-[46rem]">
        <div className="pt-4" data-product-part="back">
          <div className={`h-10 w-44 rounded-full bg-secondary ${pulse}`} />
        </div>
        <div className="mt-3 rounded-[1.75rem] bg-muted p-4" data-product-part="hero">
          <div className={`h-4 w-20 rounded bg-placeholder/30 ${pulse}`} />
          <div className={`mt-3 aspect-[16/9] w-full rounded-2xl bg-placeholder/20 ${pulse}`} />
          <div className={`mt-4 h-11 w-32 rounded-md bg-placeholder/20 ${pulse}`} />
        </div>
        <div className={`mt-7 h-8 w-4/5 rounded-lg bg-muted md:h-10 ${pulse}`} />
        <div className={`mt-3 h-7 w-full rounded-md bg-muted/80 ${pulse}`} />
        <div className={`mt-3 h-5 w-1/3 rounded-md bg-muted/80 ${pulse}`} />
        <SectionSkeleton />
        <SectionSkeleton />
      </div>
      <p className="sr-only">Загружаем страницу продукта</p>
    </div>
  );
}

/** Практикум AI-first: возврат, слева заголовок с действием, справа иллюстрация процесса. */
export function AiFirstGuideSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Продукт загружается"
      className="ai-guide-page min-h-svh"
      data-route-skeleton="guide-product"
    >
      <div className="flex min-h-11 items-center" data-product-part="back">
        <div className={`h-5 w-40 rounded-md bg-muted ${pulse}`} />
      </div>
      <div className="ai-guide-hero" data-product-part="hero">
        <div className={`ai-guide-hero-copy ${pulse}`}>
          <div className="h-10 w-4/5 rounded-xl bg-muted md:h-14" />
          <div className="mt-4 h-6 w-full rounded-md bg-muted/80" />
          <div className="mt-2 h-6 w-11/12 rounded-md bg-muted/80" />
          <div className="mt-2 h-6 w-3/5 rounded-md bg-muted/80" />
          <div className="mt-5 flex flex-wrap gap-2">
            <div className="h-8 w-28 rounded-full bg-secondary" />
            <div className="h-8 w-32 rounded-full bg-secondary" />
            <div className="h-8 w-36 rounded-full bg-secondary" />
          </div>
          <div className="mt-6 hidden h-12 w-52 rounded-xl bg-muted md:block" />
        </div>
        <div className={`ai-guide-artwork bg-muted ${pulse}`} />
      </div>
      <div className="my-12 md:my-16">
        <SectionSkeleton />
      </div>
      <p className="sr-only">Загружаем страницу продукта</p>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className={`mt-10 ${pulse}`}>
      <div className="h-7 w-1/2 rounded-lg bg-muted md:h-8" />
      <div className="mt-4 grid gap-2">
        <div className="h-6 w-full rounded-md bg-muted/80" />
        <div className="h-6 w-11/12 rounded-md bg-muted/80" />
        <div className="h-6 w-4/5 rounded-md bg-muted/80" />
      </div>
    </div>
  );
}
