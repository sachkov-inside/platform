"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  billingErrorMessage,
  type PriceSnapshot,
} from "@/entities/subscription";
import {
  BillingContactPanel,
  type BillingContactState,
} from "@/features/billing-contact";
import { CheckoutFlow } from "@/features/billing-checkout";
import { currentBillingQueryOptions } from "@/features/billing-subscription";
import { internalRoute } from "@/shared/routing/internal-route";

import { GuidePurchaseView } from "./guide-purchase-view";

const contactHref = internalRoute("/account/email");

export interface GuidePurchaseProps {
  readonly guide: { readonly name: string; readonly summary: string } | null;
  readonly offer: PriceSnapshot | null;
  readonly slug: string;
  readonly unavailable?: boolean;
}

/** Собственные покупки читает браузер: витрина рендерится сервером и без них. */
export function GuidePurchase({
  guide,
  offer,
  slug,
  unavailable = false,
}: GuidePurchaseProps) {
  const [contactState, setContactState] = useState<BillingContactState | null>(
    null,
  );
  const billing = useQuery(currentBillingQueryOptions());
  const signedOut =
    billing.data?.ok === false && billing.data.code === "unauthorized";
  const viewer = billing.isPending ? "loading" : signedOut ? "guest" : "member";
  const failure =
    billing.data?.ok === false && !signedOut ? billing.data.code : undefined;

  return (
    <GuidePurchaseView
      guide={guide}
      offer={offer}
      slug={slug}
      unavailable={unavailable}
      viewer={viewer}
      {...(failure === undefined
        ? {}
        : { notice: billingErrorMessage(failure) })}
    >
      {offer === null ? null : (
        <>
          <CheckoutFlow
            contact={contactState?.contact ?? null}
            contactHref={contactHref}
            documents={contactState?.documents ?? []}
            snapshot={offer}
          />
          <BillingContactPanel onStateChange={setContactState} />
        </>
      )}
    </GuidePurchaseView>
  );
}
