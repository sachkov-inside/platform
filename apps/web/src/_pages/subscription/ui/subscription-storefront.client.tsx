"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  OfferCard,
  billingErrorMessage,
  formatKopecks,
  formatMonths,
  publicSubscriptionOffers,
  type PriceSnapshot,
} from "@/entities/subscription";
import {
  BillingContactPanel,
  type BillingContactState,
} from "@/features/billing-contact";
import { CheckoutFlow } from "@/features/billing-checkout";
import { currentBillingQueryOptions } from "@/features/billing-subscription";
import { Button } from "@/shared/ui/button";

export interface SubscriptionStorefrontProps {
  readonly offers: readonly PriceSnapshot[];
  readonly unavailable?: boolean;
  /** Куда вернуть покупателя после входа: контекст страницы руководства сохраняется. */
  readonly returnTo: string;
  readonly originHref?: string;
  readonly cabinetHref?: string;
  readonly contactHref?: string;
}

export function SubscriptionStorefront({
  offers: catalog,
  unavailable = false,
  returnTo,
  originHref,
  cabinetHref = "/account/subscription",
  contactHref = "/account/email",
}: SubscriptionStorefrontProps) {
  const offers = publicSubscriptionOffers(catalog);
  const [selectedId, setSelectedId] = useState<string | null>(
    offers[0]?.paymentOption.id ?? null,
  );
  const [contactState, setContactState] = useState<BillingContactState | null>(
    null,
  );
  const billing = useQuery(currentBillingQueryOptions());
  const selected =
    offers.find((offer) => offer.paymentOption.id === selectedId) ?? null;
  const signedOut = billing.data?.ok === false && billing.data.code === "unauthorized";
  const subscription =
    billing.data?.ok === true ? billing.data.value.subscription : null;
  const currentOptionId = subscription?.snapshot.paymentOption.id ?? null;

  return (
    <div className="mx-auto grid max-w-5xl gap-8">
      <header className="grid gap-3">
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
          Подписка Sachkov Inside
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          Оба тарифа открывают все опубликованные материалы и руководства.
          Старший добавляет вопросы автору, эфиры и общий чат.
        </p>
        {originHref === undefined ? null : (
          <p className="text-sm">
            <Link
              className="text-action underline underline-offset-4"
              href={{ pathname: originHref }}
            >
              Вернуться к материалу
            </Link>
          </p>
        )}
      </header>

      {unavailable || offers.length === 0 ? (
        <p
          className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 shadow-card"
          role="status"
        >
          Тарифы сейчас недоступны. Обновите страницу позже — цены и состав
          приходят с сервера.
        </p>
      ) : (
        <>
          {subscription === null ? null : (
            <p className="rounded-2xl border border-accent/35 bg-accent/6 p-4 text-sm leading-6">
              У вас уже есть подписка «{subscription.snapshot.offer.name}».{" "}
              <Link
                className="font-semibold text-action underline underline-offset-4"
                href={{ pathname: cabinetHref }}
              >
                Управлять ею в платёжном кабинете
              </Link>
              .
            </p>
          )}

          <fieldset>
            <legend className="text-sm font-semibold text-muted-foreground">
              Выберите тариф
            </legend>
            <ul className="mt-4 grid gap-5 md:grid-cols-2">
              {offers.map((offer) => (
                <li className="min-w-0" key={offer.paymentOption.id}>
                  <OfferCard
                    current={currentOptionId === offer.paymentOption.id}
                    headingLevel="h2"
                    selected={selectedId === offer.paymentOption.id}
                    snapshot={offer}
                  >
                    <label className="flex items-center gap-3 text-sm font-semibold">
                      <input
                        checked={selectedId === offer.paymentOption.id}
                        className="size-5 shrink-0 accent-primary"
                        name="subscription-offer"
                        onChange={() => {
                          setSelectedId(offer.paymentOption.id);
                        }}
                        type="radio"
                        value={offer.paymentOption.id}
                      />
                      Выбрать за {formatKopecks(offer.firstPriceKopecks)} /{" "}
                      {formatMonths(offer.paymentOption.months)}
                    </label>
                  </OfferCard>
                </li>
              ))}
            </ul>
          </fieldset>

          {billing.isPending ? (
            <p className="text-sm text-muted-foreground" role="status">
              Проверяем вашу подписку…
            </p>
          ) : signedOut ? (
            <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <h2 className="text-xl font-semibold">Войдите, чтобы оформить</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                После входа вы вернётесь сюда и продолжите с выбранного тарифа.
              </p>
              <form action="/auth/sign-in" className="mt-4" method="post">
                <input name="returnTo" type="hidden" value={returnTo} />
                <Button className="h-auto min-h-11 max-w-full whitespace-normal" type="submit">
                  Войти
                </Button>
              </form>
            </section>
          ) : selected === null ? null : (
            <div className="grid gap-6 lg:grid-cols-2">
              <CheckoutFlow
                contact={contactState?.contact ?? null}
                contactHref={contactHref}
                documents={contactState?.documents ?? []}
                snapshot={selected}
              />
              <BillingContactPanel onStateChange={setContactState} />
            </div>
          )}
        </>
      )}

      {billing.data?.ok === false && !signedOut ? (
        <p className="text-sm text-muted-foreground" role="status">
          {billingErrorMessage(billing.data.code)}
        </p>
      ) : null}
    </div>
  );
}
