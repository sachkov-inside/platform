import type { ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import { HideMobileNavigation } from "@/shared/ui/hide-mobile-navigation.client";
import {
  PaymentLinkSummary,
  paymentLinkHref,
  paymentLinkStateLabels,
  type PaymentLinkDetail,
} from "@/entities/subscription";
import type { ProductPurchaseViewer } from "./product-purchase-view";

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
  return (
    <section className="mx-auto w-full min-w-0 max-w-[1080px] py-8 pb-20">
      <HideMobileNavigation />
      <header className="mb-9">
        <h1 className="mb-3 text-[2rem] font-semibold leading-tight tracking-[-0.02em]">
          Покупка по ссылке
        </h1>
        <p className="max-w-prose text-sm leading-6">
          Доступ получит аккаунт, с которого вы оплатите покупку.
        </p>
      </header>
      <div className="grid min-w-0 gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] md:gap-14">
        <PaymentLinkSummary
          headingLevel={2}
          snapshot={link.snapshot}
          title={link.product?.title ?? link.snapshot.offer.name}
        />
        <div className="min-w-0">
          <div className="mb-6">{progress}</div>
          {hasPurchase ? (
            children
          ) : !active ? (
            <section role="status" className="space-y-4 text-sm leading-6">
              <h2 className="text-xl font-semibold">
                {usable
                  ? paymentLinkStateLabels[link.state]
                  : "Продукт сейчас недоступен"}
              </h2>
              <p>
                {link.state === "pending" || link.state === "unknown"
                  ? "Банк ещё не подтвердил результат. Не начинайте новую оплату. Ссылка зарезервирована за текущей попыткой."
                  : link.state === "paid"
                    ? "По этой ссылке уже совершена покупка. Повторная покупка недоступна."
                    : "Оплатить по этой ссылке нельзя. Запросите у владельца новую ссылку."}
              </p>
            </section>
          ) : (
            <>
              <h2 className="mb-4 text-xl font-semibold">Оформление покупки</h2>
              <p className="mb-4 text-sm leading-6">
                По ссылке можно совершить одну покупку. Её можно передать
                другому человеку.
              </p>
              <p className="mb-6 text-sm text-muted-foreground">
                {link.expiresAt === null
                  ? "Без ограничения срока действия ссылки."
                  : `Действует до ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date(link.expiresAt))} (Москва).`}
              </p>
              {viewer === "guest" ? (
                <form action="/auth/sign-in" method="post">
                  <input
                    type="hidden"
                    name="returnTo"
                    value={paymentLinkHref(link.id)}
                  />
                  <Button type="submit" className="min-h-11">
                    Войти для покупки
                  </Button>
                </form>
              ) : viewer === "loading" ? (
                <p role="status">Проверяем ваши покупки…</p>
              ) : (
                children
              )}
            </>
          )}
          {notice !== undefined && (
            <p role="status" className="mt-4 text-sm">
              {notice}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
