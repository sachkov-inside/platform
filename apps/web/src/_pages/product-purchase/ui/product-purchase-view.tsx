import { GuestPurchase } from "./guest-purchase";
import { IndividualPurchaseView } from "./individual-purchase-view";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";

import type {
  PaymentLinkDetail,
  PreorderTerms,
  PriceSnapshot,
} from "@/entities/subscription";

import {
  productProgrammeHref,
  productPurchaseHref,
} from "@/shared/routing/subscription-route";
import { HideMobileNavigation } from "@/shared/ui/hide-mobile-navigation.client";

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
  readonly progress?: ReactNode;
  readonly hasPurchase?: boolean;
  readonly individualLink?: PaymentLinkDetail;
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
  progress,
  hasPurchase = false,
  individualLink,
}: ProductPurchaseViewProps) {
  if (individualLink !== undefined)
    return (
      <IndividualPurchaseView
        link={individualLink}
        viewer={viewer}
        hasPurchase={hasPurchase}
        progress={progress}
        notice={notice}
      >
        {children}
      </IndividualPurchaseView>
    );
  const programmeHref = productProgrammeHref(slug);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[38rem]">
      {/* Страница покупки, как и страница курса, обходится без общей нижней навигации: путь
          назад — ссылка вверху (решение владельца 09.10.2026). */}
      <HideMobileNavigation />
      <nav
        aria-label="Путь навигации"
        className="pt-4"
        data-purchase-part="back"
      >
        <Link
          className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
          href={programmeHref}
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          <span>Программа</span>
        </Link>
      </nav>

      <div className="mt-6">{progress}</div>
      <h1
        className="mt-6 break-words text-2xl font-bold leading-[1.15] tracking-[-0.03em] md:text-3xl"
        data-purchase-part="title"
      >
        {product?.name ?? "Продукт"}
      </h1>

      <div className="mt-6">
        {hasPurchase ? (
          children
        ) : unavailable ? (
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
