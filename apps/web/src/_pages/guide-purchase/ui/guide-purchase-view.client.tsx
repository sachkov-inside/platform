"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  billingActionClass,
  OfferCard,
  billingErrorMessage,
  formatKopecks,
  type PriceSnapshot,
} from "@/entities/subscription";
import {
  BillingContactPanel,
  type BillingContactState,
} from "@/features/billing-contact";
import { CheckoutFlow } from "@/features/billing-checkout";
import { currentBillingQueryOptions } from "@/features/billing-subscription";
import { internalRoute } from "@/shared/routing/internal-route";
import { guidePurchaseHref } from "@/shared/routing/subscription-route";
import { Button } from "@/shared/ui/button";

export interface GuidePurchaseViewProps {
  readonly guide: { readonly name: string; readonly summary: string } | null;
  readonly offer: PriceSnapshot | null;
  readonly slug: string;
  readonly unavailable?: boolean;
  readonly contactHref?: string;
}

/**
 * Руководство продаётся, только когда владелец завёл ему цену, поэтому отсутствие предложения
 * здесь — обычное состояние, а не ошибка. Подписка на эту страницу не влияет: её можно
 * не включать вовсе.
 */
export function GuidePurchaseView({
  guide,
  offer,
  slug,
  unavailable = false,
  contactHref = "/account/email",
}: GuidePurchaseViewProps) {
  const [contactState, setContactState] = useState<BillingContactState | null>(
    null,
  );
  const billing = useQuery(currentBillingQueryOptions());
  const guideHref = internalRoute(`/guides/${encodeURIComponent(slug)}`);
  const signedOut =
    billing.data?.ok === false && billing.data.code === "unauthorized";

  return (
    <div className="mx-auto grid max-w-5xl gap-8">
      <header className="grid gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Покупка руководства
        </p>
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
          {guide?.name ?? "Руководство"}
        </h1>
        {guide === null || guide.summary === "" ? null : (
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            {guide.summary}
          </p>
        )}
        <p className="text-sm">
          <Link
            className="text-action underline underline-offset-4"
            href={guideHref}
          >
            Вернуться к руководству
          </Link>
        </p>
      </header>

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
          Это руководство сейчас не продаётся отдельно.
        </p>
      ) : billing.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Проверяем ваши покупки…
        </p>
      ) : signedOut ? (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-xl font-semibold">Войдите, чтобы купить</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            После входа вы вернётесь сюда и продолжите покупку за{" "}
            {formatKopecks(offer.firstPriceKopecks)}.
          </p>
          <form action="/auth/sign-in" className="mt-4" method="post">
            <input name="returnTo" type="hidden" value={guidePurchaseHref(slug)} />
            <Button className={billingActionClass} type="submit">
              Войти
            </Button>
          </form>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <OfferCard headingLevel="h2" snapshot={offer} />
          <CheckoutFlow
            contact={contactState?.contact ?? null}
            contactHref={internalRoute(contactHref)}
            documents={contactState?.documents ?? []}
            snapshot={offer}
          />
          <BillingContactPanel onStateChange={setContactState} />
        </div>
      )}

      {billing.data?.ok === false && !signedOut ? (
        <p className="text-sm text-muted-foreground" role="status">
          {billingErrorMessage(billing.data.code)}
        </p>
      ) : null}
    </div>
  );
}
