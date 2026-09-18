const pulse = "animate-pulse motion-reduce:animate-none";

/**
 * Скелет страницы оплаты (#670). Собран из её рамки: та же колонка, тот же ряд возврата в программу
 * и то же место заголовка, поэтому готовая страница встаёт на место скелета. Без него переход
 * «Купить» показывал бы скелет продукта, под чьим адресом страница лежит. Высота не меньше экрана:
 * подвал ждёт за краем и не прыгает.
 */
export function GuidePurchaseLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Оплата загружается"
      className="mx-auto min-h-svh w-full min-w-0 max-w-[38rem]"
      data-route-skeleton="guide-purchase"
    >
      <div className="pt-4" data-purchase-part="back">
        <div className={`h-11 w-36 rounded-full bg-muted ${pulse}`} />
      </div>
      <div className={`mt-6 ${pulse}`} data-purchase-part="title">
        <div className="h-7 w-4/5 rounded-lg bg-muted md:h-[2.15rem]" />
      </div>
      <div className={`mt-3 grid gap-2 ${pulse}`}>
        <div className="h-5 w-full rounded-md bg-muted/80" />
        <div className="h-5 w-3/5 rounded-md bg-muted/80" />
      </div>
      <div className={`mt-6 h-48 rounded-2xl bg-muted/65 ${pulse}`} />
      <p className="sr-only">Загружаем страницу оплаты</p>
    </div>
  );
}
