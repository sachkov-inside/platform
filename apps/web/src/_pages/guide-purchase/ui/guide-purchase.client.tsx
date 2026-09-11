"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  billingErrorMessage,
  formatKopecks,
  offerCompositionLabel,
  type PriceSnapshot,
} from "@/entities/subscription";
import {
  BillingContactPanel,
  type BillingContactState,
} from "@/features/billing-contact";
import { CheckoutFlow, type CheckoutInclusion } from "@/features/billing-checkout";
import { currentBillingQueryOptions } from "@/features/billing-subscription";
import { internalRoute } from "@/shared/routing/internal-route";
import { cn } from "@/shared/lib/utils";

import { GuidePurchaseView } from "./guide-purchase-view";

const contactHref = internalRoute("/account/email");

export interface GuidePurchaseProps {
  readonly guide: { readonly name: string; readonly summary: string } | null;
  /** Варианты покупки этого руководства: обычно один, но выбор поддержан с самого начала. */
  readonly offers: readonly PriceSnapshot[];
  readonly slug: string;
  readonly unavailable?: boolean;
}

/** Собственные покупки читает браузер: страница рендерится сервером и без них. */
export function GuidePurchase({
  guide,
  offers,
  slug,
  unavailable = false,
}: GuidePurchaseProps) {
  const [contactState, setContactState] = useState<BillingContactState | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    offers[0]?.paymentOption.id ?? null,
  );
  const billing = useQuery(currentBillingQueryOptions());
  const signedOut =
    billing.data?.ok === false && billing.data.code === "unauthorized";
  const viewer = billing.isPending ? "loading" : signedOut ? "guest" : "member";
  const failure =
    billing.data?.ok === false && !signedOut ? billing.data.code : undefined;
  const selected =
    offers.find((offer) => offer.paymentOption.id === selectedId) ?? offers[0] ?? null;

  return (
    <GuidePurchaseView
      guide={guide}
      offer={selected}
      slug={slug}
      unavailable={unavailable}
      viewer={viewer}
      {...(failure === undefined
        ? {}
        : { notice: billingErrorMessage(failure) })}
    >
      {selected === null ? null : (
        <>
          {offers.length < 2 ? null : (
            <fieldset className="mb-6">
              <legend className="text-sm font-semibold text-muted-foreground">
                Что берёте
              </legend>
              <ul className="mt-3 grid gap-3">
                {offers.map((offer) => (
                  <li key={offer.paymentOption.id}>
                    <label
                      className={cn(
                        "flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border p-4",
                        offer.paymentOption.id === selected.paymentOption.id
                          ? "border-accent"
                          : "border-border",
                      )}
                    >
                      <input
                        checked={offer.paymentOption.id === selected.paymentOption.id}
                        className="size-5 shrink-0 accent-primary"
                        name="guide-offer"
                        onChange={() => {
                          setSelectedId(offer.paymentOption.id);
                        }}
                        type="radio"
                        value={offer.paymentOption.id}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-semibold leading-6">
                          {offerCompositionLabel(offer.offer)}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {offer.offer.name}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums font-semibold">
                        {formatKopecks(offer.firstPriceKopecks)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <CheckoutFlow
            contact={contactState?.contact ?? null}
            contactHref={contactHref}
            documents={contactState?.documents ?? []}
            inclusions={inclusionsOf(selected)}
            snapshot={selected}
          />
          <div className="mt-8">
            <BillingContactPanel onStateChange={setContactState} />
          </div>
        </>
      )}
    </GuidePurchaseView>
  );
}

/**
 * Что именно получает покупатель — из состава предложения и его сроков, а не из рекламного
 * текста. Бессрочное право названо бессрочным, потому что так оно и выдаётся.
 */
function inclusionsOf(snapshot: PriceSnapshot): readonly CheckoutInclusion[] {
  const perpetual = snapshot.offer.benefits.every((capability) => {
    const period = snapshot.offer.benefitPeriods?.find(
      (entry) => entry.capability === capability,
    );
    return period === undefined || period.months === null;
  });
  return [
    {
      caption: "Доступ",
      title: perpetual ? "Навсегда" : "На срок предложения",
      detail: "без подписки",
    },
    {
      caption: "Состав",
      title: offerCompositionLabel(snapshot.offer),
      detail: snapshot.offer.name,
    },
  ];
}
