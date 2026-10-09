"use client";
import { initialPaymentOptionId } from "../model/initial-selection";
import { useState } from "react";

import {
  billingErrorMessage,
  formatKopecks,
  offerCompositionLabel,
  type PreorderTerms,
  type PriceSnapshot,
} from "@/entities/subscription";
import { useBillingContact } from "@/features/billing-contact";
import { CheckoutFlow } from "@/features/billing-checkout";
import { useCurrentBilling } from "@/features/billing-subscription";
import { internalRoute } from "@/shared/routing/internal-route";
import { cn } from "@/shared/lib/utils";

import { ProductPurchaseView } from "./product-purchase-view";

const contactHref = internalRoute("/account/email");

export interface ProductPurchaseProps {
  readonly product: { readonly name: string; readonly summary: string } | null;
  /** Варианты покупки этого руководства: обычно один, но выбор поддержан с самого начала. */
  readonly offers: readonly PriceSnapshot[];
  readonly slug: string;
  readonly offerId?: string;
  readonly unavailable?: boolean;
  /** Промокод персональной ссылки владельца: переживает вход и уходит в расчёт цены. */
  readonly promoCode?: string;
  /** Пока поток набирается: день старта и цена после него, зачёркнутая рядом с ценой. */
  readonly preorder?: PreorderTerms | null;
}

/** Собственные покупки читает браузер: страница рендерится сервером и без них. */
export function ProductPurchase({
  product,
  offers,
  slug,
  unavailable = false,
  promoCode,
  offerId,
  preorder = null,
}: ProductPurchaseProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPaymentOptionId(offers, offerId),
  );
  const billing = useCurrentBilling();
  // Подтверждённый контакт и редакции документов нужны самому оформлению, поэтому страница
  // читает их прямо, а не через форму подтверждения: формы здесь больше нет.
  const contact = useBillingContact();
  const contactState = contact.data?.ok === true ? contact.data : null;
  const signedOut =
    billing.data?.ok === false && billing.data.code === "unauthorized";
  const viewer = billing.isPending ? "loading" : signedOut ? "guest" : "member";
  const failure =
    billing.data?.ok === false && !signedOut ? billing.data.code : undefined;
  const selected =
    offers.find((offer) => offer.paymentOption.id === selectedId) ??
    offers[0] ??
    null;

  return (
    <ProductPurchaseView
      product={product}
      offer={selected}
      {...(offerId === undefined ? {} : { offerId })}
      preorder={preorder}
      slug={slug}
      unavailable={unavailable}
      viewer={viewer}
      {...(promoCode === undefined ? {} : { promoCode })}
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
                        checked={
                          offer.paymentOption.id === selected.paymentOption.id
                        }
                        className="size-5 shrink-0 accent-primary"
                        name="product-offer"
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
            showInclusions
            onDocumentsChanged={() => {
              void contact.refetch();
            }}
            preorder={preorder}
            snapshot={selected}
            {...(promoCode === undefined ? {} : { promoCode })}
          />
        </>
      )}
    </ProductPurchaseView>
  );
}
