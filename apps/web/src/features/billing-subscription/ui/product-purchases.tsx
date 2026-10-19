import { BillingDisclosure } from "./billing-disclosure.client";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import {
  productProgrammeHref,
  productPurchaseHref,
} from "@/shared/routing/subscription-route";
import {
  attemptStateLabel,
  formatKopecks,
  formatMonths,
  isProductCapability,
  capabilityLabel,
  type OwnPayment,
} from "@/entities/subscription";

function accessLabel(access: OwnPayment["access"], state: OwnPayment["state"]) {
  return access === "ready"
    ? "Доступ открыт"
    : access === "preparing"
      ? "Подготавливаем доступ"
      : access === "unavailable"
        ? "Действующего доступа нет"
        : state === "failed"
          ? "Доступ не выдан"
          : "Ожидаем оплату";
}

export function ProductPurchases({
  payments,
}: {
  readonly payments: readonly OwnPayment[];
}) {
  const purchases = payments.filter(
    (payment) =>
      payment.kind === "one_time" &&
      (payment.content ?? []).some((entry) => entry.kind === "product"),
  );
  if (purchases.length === 0) return null;
  return (
    <section aria-labelledby="product-purchases">
      <h2 id="product-purchases" className="text-xl font-semibold">
        Покупки продуктов
      </h2>
      <ul className="mt-4 grid gap-4">
        {purchases.map((payment) => {
          const products = (payment.content ?? []).filter(
            (item) => item.kind === "product",
          );
          return (
            <li
              key={payment.purchaseRef}
              className="rounded-2xl border border-border bg-card p-5 sm:p-7"
            >
              <h3 className="text-xl font-semibold">
                {products.map((item) => item.title).join(", ")}
              </h3>
              <p className="mt-3 text-2xl font-bold tabular-nums">
                {formatKopecks(payment.amountKopecks)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {payment.refundedKopecks > 0
                  ? `Возвращено ${formatKopecks(payment.refundedKopecks)}`
                  : attemptStateLabel(payment.state)}
              </p>
              <ul className="mt-3 grid gap-4">
                {products.map((item) => {
                  const access =
                    payment.productAccess?.find(
                      (entry) => entry.productId === item.id,
                    )?.access ?? payment.access;
                  return (
                    <li key={item.id}>
                      {products.length > 1 ? (
                        <p className="font-medium">{item.title}</p>
                      ) : null}
                      <p className="text-sm">
                        {accessLabel(access, payment.state)}
                      </p>
                      {item.slug === null ? null : (
                        <Button asChild className="mt-3" variant="outline">
                          <Link
                            href={
                              access === "ready"
                                ? productProgrammeHref(item.slug)
                                : productPurchaseHref(
                                    item.slug,
                                    undefined,
                                    undefined,
                                    payment.purchaseRef,
                                  )
                            }
                            aria-label={
                              products.length > 1
                                ? `${access === "ready" ? "Открыть" : "Продолжить покупку"} «${item.title}»`
                                : undefined
                            }
                          >
                            {access === "ready"
                              ? "Открыть продукт"
                              : access === "unavailable"
                                ? "К странице продукта"
                                : "Продолжить покупку"}
                          </Link>
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {payment.snapshot === undefined ? null : (
                <BillingDisclosure title="Условия этой покупки">
                  <ul className="grid gap-1">
                    {payment.snapshot.offer.benefitPeriods?.map((term) => (
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
                </BillingDisclosure>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
