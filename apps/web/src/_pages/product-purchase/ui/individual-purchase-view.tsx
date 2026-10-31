import type { ReactNode } from "react";
import { HideMobileNavigation } from "@/shared/ui/hide-mobile-navigation.client";
import {
  paymentLinkHref,
  paymentLinkStateLabels,
  type PaymentLinkDetail,
} from "@/entities/subscription";
import { GuestPurchase } from "./guest-purchase";
import type { ProductPurchaseViewer } from "./product-purchase-view";

/**
 * Покупка по личной ссылке: одна колонка, как у обычной покупки. Цену показывает один блок:
 * гостю карточка входа, участнику оформление оплаты. Срок ссылки оферта велит показать до
 * оплаты, поэтому он стоит под названием, только когда задан.
 */
export function IndividualPurchaseView({
  link,
  viewer,
  hasPurchase,
  children,
  progress,
  notice,
}: {
  readonly link: PaymentLinkDetail;
  readonly viewer: ProductPurchaseViewer;
  readonly hasPurchase: boolean;
  readonly children: ReactNode;
  readonly progress: ReactNode;
  readonly notice?: string | undefined;
}) {
  const usable =
    link.product !== null &&
    link.product.available &&
    link.product.slug !== null;
  const active = link.state === "active" && usable;
  const regular =
    link.snapshot.individualPayment?.basePriceKopecks ??
    link.snapshot.paymentOption.priceKopecks;
  return (
    <div className="mx-auto w-full min-w-0 max-w-[38rem] py-8 pb-20">
      <HideMobileNavigation />
      <div>{progress}</div>
      <h1 className="mt-6 break-words text-2xl font-bold leading-[1.15] tracking-[-0.03em] md:text-3xl">
        {link.product?.title ?? link.snapshot.offer.name}
      </h1>
      {active && !hasPurchase && link.expiresAt !== null ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {`Ссылка действует до ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date(link.expiresAt))} (Москва).`}
        </p>
      ) : null}

      <div className="mt-6">
        {hasPurchase ? (
          children
        ) : !active ? (
          <section
            role="status"
            className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 shadow-card"
          >
            <h2 className="text-xl font-semibold">
              {usable
                ? paymentLinkStateLabels[link.state]
                : "Продукт сейчас недоступен"}
            </h2>
            <p className="mt-2">
              {link.state === "pending" || link.state === "unknown"
                ? "Банк ещё не подтвердил оплату. Дождитесь результата: ссылка занята этой покупкой."
                : link.state === "paid"
                  ? "По этой ссылке уже совершена покупка. Повторная покупка недоступна."
                  : "Оплатить по этой ссылке нельзя. Запросите у владельца новую ссылку."}
            </p>
          </section>
        ) : viewer === "guest" ? (
          <GuestPurchase
            offer={link.snapshot}
            preorder={null}
            promoCode={undefined}
            regularPriceKopecks={
              regular > link.snapshot.firstPriceKopecks ? regular : null
            }
            returnTo={paymentLinkHref(link.id)}
          />
        ) : viewer === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Проверяем ваши покупки…
          </p>
        ) : (
          children
        )}
      </div>
      {notice !== undefined && (
        <p role="status" className="mt-5 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
