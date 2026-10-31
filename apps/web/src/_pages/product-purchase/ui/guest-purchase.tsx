import { ArrowRight } from "lucide-react";

import {
  billingActionClass,
  formatKopecks,
  preorderDiscount,
  StartCountdownBadge,
  type PreorderTerms,
  type PriceSnapshot,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

/**
 * Гостю — одна карточка: два шага покупки, цена и кнопка входа. Описание продукта и условия здесь
 * не повторяются: их человек уже видел на странице курса, а оформление покажет после входа.
 */
export function GuestPurchase({
  offer,
  preorder,
  promoCode,
  returnTo,
  regularPriceKopecks = null,
}: {
  readonly offer: PriceSnapshot;
  readonly preorder: PreorderTerms | null;
  readonly promoCode: string | undefined;
  readonly returnTo: string;
  /** Обычная цена при скидке по личной ссылке: зачёркнута рядом с ценой. */
  readonly regularPriceKopecks?: number | null;
}) {
  // Зачёркнута цена после старта предзаказа или полная цена личной ссылки.
  const higher = preorder?.priceAfterStartKopecks ?? regularPriceKopecks;
  const struck =
    higher !== null && higher > offer.firstPriceKopecks ? higher : null;
  const discount = preorderDiscount(offer.firstPriceKopecks, struck);
  return (
    <section className="relative rounded-2xl border border-border bg-card p-5 shadow-card sm:rounded-3xl sm:p-8">
      {preorder === null ? null : (
        <StartCountdownBadge text={preorder.daysLeft} />
      )}

      <div className="mt-6 flex items-center justify-between gap-3 sm:mt-7">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {preorder === null ? "Цена" : "Предзаказ"}
        </p>
        {discount === null ? null : (
          <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-accent-foreground">
            {discount}
          </span>
        )}
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2.5">
        <span className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
          {formatKopecks(offer.firstPriceKopecks)}
        </span>
        {struck === null ? null : (
          <s className="text-base text-muted-foreground sm:text-lg">
            <span className="sr-only">
              {preorder === null ? "Обычная цена: " : "Цена после старта: "}
            </span>
            {formatKopecks(struck)}
          </s>
        )}
      </p>

      <form
        action="/auth/sign-in"
        className="mt-5 border-t border-border pt-5 sm:mt-6 sm:pt-6"
        method="post"
      >
        <input name="returnTo" type="hidden" value={returnTo} />
        <Button
          className={`${billingActionClass} w-full gap-2 text-[0.9375rem] font-semibold sm:min-h-12 sm:text-base`}
          type="submit"
        >
          Войти и оплатить
          <ArrowRight aria-hidden="true" />
        </Button>
      </form>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {promoCode === undefined
          ? "После входа вы сразу вернётесь к оплате"
          : "После входа скидка по ссылке применится к цене"}
      </p>
    </section>
  );
}
