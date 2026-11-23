import type { PriceSnapshot } from "./billing-contract";

/**
 * Скидка, которая сейчас действует на цену продукта: её показывают бейдж на Главной, полоса над
 * страницей курса и метка набора. Сервер кладёт в цену только скидку без кода, поэтому она
 * одинакова для всех посетителей.
 */
export interface SaleDiscount {
  /** «−25 %», как скидка в билете. */
  readonly percent: string;
  /** «25 %» для подписи «Скидка 25 %». */
  readonly amount: string;
  /** Название скидки из админки: «Чёрная пятница». */
  readonly name: string;
  /** «до 30 ноября»: последний день по Москве; `null`, если цена не несёт конец скидки. */
  readonly until: string | null;
}

const moscowDayMonth = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Moscow",
});

export function saleDiscount(offer: PriceSnapshot | null): SaleDiscount | null {
  const promotion = offer?.promotion ?? null;
  if (promotion === null) return null;
  return {
    percent: `−${String(promotion.percent)} %`,
    amount: `${String(promotion.percent)} %`,
    name: promotion.name,
    // Конец периода уже не входит в скидку: последний день — тот, что идёт за миг до него.
    until:
      promotion.endsAt === undefined
        ? null
        : `до ${moscowDayMonth.format(Date.parse(promotion.endsAt) - 1)}`,
  };
}
