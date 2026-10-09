import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";

import {
  billingActionClass,
  formatKopecks,
  preorderDiscount,
  type PreorderTerms,
  type PriceSnapshot,
} from "@/entities/subscription";

import {
  productProgrammeHref,
  productPurchaseHref,
} from "@/shared/routing/subscription-route";
import { Button } from "@/shared/ui/button";

/** Кто смотрит страницу оплаты: это решает, показывать оформление или приглашение войти. */
export type ProductPurchaseViewer = "loading" | "guest" | "member";

export interface ProductPurchaseViewProps {
  readonly product: { readonly name: string } | null;
  readonly offer: PriceSnapshot | null;
  readonly slug: string;
  readonly viewer: ProductPurchaseViewer;
  /** Цену не удалось прочитать: это временный сбой, а не «не продаётся». */
  readonly unavailable?: boolean;
  readonly notice?: string | undefined;
  /** Промокод персональной ссылки: гость возвращается после входа с тем же кодом. */
  readonly promoCode?: string;
  readonly offerId?: string;
  /** Условия предзаказа: гость до входа видит цену предзаказа рядом с ценой после старта. */
  readonly preorder?: PreorderTerms | null;
  /** Оформление покупки участника: страница сама его не собирает. */
  readonly children?: ReactNode;
}

/**
 * Страница оплаты руководства: название, что входит, цена и одна кнопка. Цену читатель видит
 * только здесь — программа лишь приглашает оплатить. Руководство продаётся, только когда
 * владелец завёл ему цену, поэтому отсутствие предложения здесь — обычное состояние.
 */
export function ProductPurchaseView({
  product,
  offer,
  slug,
  viewer,
  unavailable = false,
  notice,
  promoCode,
  offerId,
  preorder = null,
  children,
}: ProductPurchaseViewProps) {
  const programmeHref = productProgrammeHref(slug);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[38rem]">
      <nav
        aria-label="Путь навигации"
        className="pt-4"
        data-purchase-part="back"
      >
        <Link
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-semibold"
          href={programmeHref}
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          Программа
        </Link>
      </nav>

      <h1
        className="mt-6 break-words text-2xl font-bold leading-[1.15] tracking-[-0.03em] md:text-3xl"
        data-purchase-part="title"
      >
        {product?.name ?? "Продукт"}
      </h1>

      <div className="mt-6">
        {unavailable ? (
          <p
            className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 shadow-card"
            role="status"
          >
            Цена сейчас недоступна. Обновите страницу позже — цены и состав
            приходят с сервера.
          </p>
        ) : offer === null ? (
          <p
            className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 shadow-card"
            role="status"
          >
            Этот продукт сейчас не продаётся отдельно.
          </p>
        ) : viewer === "loading" ? (
          <p className="text-sm text-muted-foreground" role="status">
            Проверяем ваши покупки…
          </p>
        ) : viewer === "guest" ? (
          <GuestPurchase
            offer={offer}
            preorder={preorder}
            promoCode={promoCode}
            returnTo={productPurchaseHref(slug, promoCode, offerId)}
          />
        ) : (
          children
        )}
      </div>

      {notice === undefined ? null : (
        <p className="mt-5 text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

/**
 * Гостю — одна карточка: два шага покупки, цена и кнопка входа. Описание продукта и условия здесь
 * не повторяются: их человек уже видел на странице курса, а оформление покажет после входа.
 */
function GuestPurchase({
  offer,
  preorder,
  promoCode,
  returnTo,
}: {
  readonly offer: PriceSnapshot;
  readonly preorder: PreorderTerms | null;
  readonly promoCode: string | undefined;
  readonly returnTo: string;
}) {
  const after = preorder?.priceAfterStartKopecks ?? null;
  const struck =
    after !== null && after > offer.firstPriceKopecks ? after : null;
  const discount = preorderDiscount(offer.firstPriceKopecks, struck);
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
      <ol
        aria-label="Шаги покупки"
        className="flex items-center gap-2 text-xs font-semibold"
      >
        <li className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-foreground text-background">
            1
          </span>
          Вход
        </li>
        <li aria-hidden="true" className="h-px w-8 bg-border" />
        <li className="flex items-center gap-2 text-muted-foreground">
          <span className="grid size-6 place-items-center rounded-full border border-border">
            2
          </span>
          Оплата
        </li>
      </ol>

      <p className="mt-7 text-sm font-medium text-muted-foreground">
        {preorder === null ? "Цена" : "Предзаказ"}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-4xl font-bold tracking-[-0.03em]">
          {formatKopecks(offer.firstPriceKopecks)}
        </span>
        {struck === null ? null : (
          <s className="text-lg text-muted-foreground">
            <span className="sr-only">Цена после старта: </span>
            {formatKopecks(struck)}
          </s>
        )}
        {discount === null ? null : (
          <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-accent-foreground">
            {discount}
          </span>
        )}
      </p>
      {preorder === null ? null : (
        <p className="mt-1 text-sm text-muted-foreground">
          {preorder.daysLeft}
        </p>
      )}

      <form action="/auth/sign-in" className="mt-7" method="post">
        <input name="returnTo" type="hidden" value={returnTo} />
        <Button
          className={`${billingActionClass} min-h-12 w-full gap-2 text-base font-semibold`}
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
