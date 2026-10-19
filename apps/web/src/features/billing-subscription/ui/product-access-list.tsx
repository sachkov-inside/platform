import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { ArrowUpRight } from "lucide-react";
import {
  accessSourceLabel,
  attemptStateLabel,
  capabilityLabel,
  formatBillingDate,
  formatKopecks,
  formatMonths,
  isProductCapability,
  type AccessGround,
  type OwnPayment,
} from "@/entities/subscription";
import {
  productProgrammeHref,
  productPurchaseHref,
} from "@/shared/routing/subscription-route";
import { accountProducts } from "../model/account-products";
import { BillingDisclosure } from "./billing-disclosure.client";

function accessLabel(
  access: OwnPayment["access"],
  payment: OwnPayment | undefined,
) {
  if (access === "ready") return "Доступ открыт";
  if (access === "preparing") return "Подготавливаем доступ";
  if (access === "unavailable" || payment === undefined)
    return "Доступ неактивен";
  return payment.state === "failed" ? "Доступ не выдан" : "Ожидаем оплату";
}

/** One product card combines current access and its actual purchases. */
export function ProductAccessList({
  grounds,
  payments,
}: {
  readonly grounds: readonly AccessGround[];
  readonly payments: readonly OwnPayment[];
}) {
  const products = accountProducts(grounds, payments);
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="current-products">
      <h2 id="current-products" className="text-xl font-semibold">
        Ваши продукты
      </h2>
      <ul className="mt-4 grid gap-4">
        {products.map(({ product, bases, history, payment, access }) => (
          <li
            key={product.id}
            className="rounded-2xl bg-primary p-5 text-primary-foreground sm:p-6"
            data-account-product={product.id}
            aria-label={product.title}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <h3 className="min-w-0 flex-1 text-xl font-semibold [overflow-wrap:anywhere] sm:text-2xl">
                {product.title}
              </h3>
              {payment === undefined ? null : (
                <div className="text-right">
                  <p className="text-xl font-semibold tabular-nums sm:text-2xl">
                    {formatKopecks(payment.amountKopecks)}
                  </p>
                  <p className="mt-1 text-xs text-primary-foreground/80">
                    {(payment.content?.length ?? 0) > 1
                      ? "За весь набор"
                      : history.length > 1 && payment.state === "confirmed"
                        ? "Последняя оплаченная покупка"
                        : payment.state === "confirmed"
                          ? "Стоимость покупки"
                          : "Сумма покупки"}
                  </p>
                </div>
              )}
            </div>
            <p className="mt-3 text-sm text-primary-foreground/80">
              {accessLabel(access, payment)}
            </p>
            {(payment?.refundedKopecks ?? 0) > 0 ? (
              <p className="mt-2 text-sm text-primary-foreground/80">
                Возвращено {formatKopecks(payment?.refundedKopecks ?? 0)}
              </p>
            ) : null}
            {product.slug === null ||
            !product.available ||
            (access !== "ready" && payment === undefined) ? null : (
              <Button
                asChild
                variant="outline"
                className="mt-5 border-transparent bg-background text-foreground hover:bg-background/90 focus-visible:ring-primary-foreground"
              >
                <Link
                  href={
                    access === "ready"
                      ? productProgrammeHref(product.slug)
                      : productPurchaseHref(
                          product.slug,
                          undefined,
                          undefined,
                          payment?.purchaseRef,
                        )
                  }
                >
                  {access === "ready"
                    ? "Открыть продукт"
                    : access === "unavailable"
                      ? "К странице продукта"
                      : "Продолжить покупку"}
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
              </Button>
            )}
            <BillingDisclosure title="Доступ и покупка" tone="inverse">
              <ul className="grid gap-2 text-primary-foreground/80">
                {bases.map((ground, index) => (
                  <li key={index}>
                    {accessSourceLabel(ground.source)}:{" "}
                    {ground.capabilities.includes("support")
                      ? "сопровождение"
                      : ground.capabilities.includes("community")
                        ? "сообщество продукта"
                        : "материалы продукта"}
                    {ground.validUntil === null
                      ? " без даты окончания"
                      : ` до ${formatBillingDate(ground.validUntil)}`}
                    .
                  </li>
                ))}
              </ul>
              {history.map((purchase) => (
                <div
                  key={purchase.purchaseRef}
                  className="mt-4 border-t border-primary-foreground/20 pt-4 text-primary-foreground/80"
                >
                  <p>
                    {formatBillingDate(purchase.createdAt)} ·{" "}
                    {formatKopecks(purchase.amountKopecks)} ·{" "}
                    {attemptStateLabel(purchase.state)}
                  </p>
                  {(purchase.content?.length ?? 0) > 1 ? (
                    <p className="mt-2">
                      Вся покупка:{" "}
                      {purchase.content?.map((entry) => entry.title).join(", ")}
                      . Сумма относится ко всему набору.
                    </p>
                  ) : null}
                  {purchase.refundedKopecks > 0 ? (
                    <p className="mt-2">
                      Возвращено {formatKopecks(purchase.refundedKopecks)}
                    </p>
                  ) : null}
                  <ul className="mt-2 grid gap-1">
                    {purchase.snapshot?.offer.benefitPeriods?.map((term) => (
                      <li key={term.capability}>
                        {isProductCapability(term.capability) ||
                        term.capability === "materials"
                          ? "Материалы продукта"
                          : capabilityLabel(term.capability)}
                        :{" "}
                        {term.months === null
                          ? "без даты окончания"
                          : formatMonths(term.months)}
                        .
                      </li>
                    ))}
                  </ul>
                  {product.slug === null ||
                  !product.available ||
                  purchase.state === "confirmed" ? null : (
                    <Button
                      asChild
                      variant="link"
                      className="mt-2 max-w-full whitespace-normal px-0 text-left text-primary-foreground focus-visible:ring-primary-foreground"
                    >
                      <Link
                        href={productPurchaseHref(
                          product.slug,
                          undefined,
                          undefined,
                          purchase.purchaseRef,
                        )}
                      >
                        Продолжить покупку от{" "}
                        {formatBillingDate(purchase.createdAt)}
                      </Link>
                    </Button>
                  )}
                </div>
              ))}
            </BillingDisclosure>
          </li>
        ))}
      </ul>
    </section>
  );
}
