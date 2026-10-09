import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";

import {
  billingActionClass,
  formatKopecks,
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
  readonly product: { readonly name: string; readonly summary: string } | null;
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
      {product === null || product.summary === "" ? null : (
        <p className="mt-3 break-words text-sm leading-6 text-muted-foreground md:text-base">
          {product.summary}
        </p>
      )}

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
          <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
            <h2 className="text-xl font-semibold">
              {preorder === null
                ? "Войдите, чтобы купить"
                : "Войдите, чтобы оформить предзаказ"}
            </h2>
            {preorder === null || promoCode !== undefined ? null : (
              <GuestPreorderPrice offer={offer} preorder={preorder} />
            )}
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {promoCode === undefined
                ? `После входа вы вернётесь сюда и продолжите покупку за ${formatKopecks(offer.firstPriceKopecks)}.`
                : "После входа вы вернётесь сюда, и скидка по ссылке применится к цене."}
            </p>
            <form action="/auth/sign-in" className="mt-4" method="post">
              <input
                name="returnTo"
                type="hidden"
                value={productPurchaseHref(slug, promoCode, offerId)}
              />
              <Button className={billingActionClass} type="submit">
                Войти
              </Button>
            </form>
          </section>
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
 * Цена предзаказа для гостя: сумма, зачёркнутая цена после старта, если она больше, и срок. Так
 * скидку видно ещё до входа, а не только в оформлении покупки.
 */
function GuestPreorderPrice({
  offer,
  preorder,
}: {
  readonly offer: PriceSnapshot;
  readonly preorder: PreorderTerms;
}) {
  const after = preorder.priceAfterStartKopecks;
  return (
    <div className="mt-4">
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-3xl font-bold tracking-[-0.02em]">
          {formatKopecks(offer.firstPriceKopecks)}
        </span>
        {after === null || after <= offer.firstPriceKopecks ? null : (
          <s className="text-lg text-muted-foreground">
            <span className="sr-only">Цена после старта: </span>
            {formatKopecks(after)}
          </s>
        )}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Цена предзаказа действует до старта потока {preorder.startsOn}.
      </p>
    </div>
  );
}
