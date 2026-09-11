"use client";
import { useState } from "react";

import {
  publicSubscriptionOffers,
  type PriceSnapshot,
} from "@/entities/subscription";
import {
  BillingContactPanel,
  type BillingContactState,
} from "@/features/billing-contact";
import { BillingCabinetPanel } from "@/features/billing-subscription";

export interface BillingAccountViewProps {
  readonly options: readonly PriceSnapshot[];
}

/**
 * Кабинет и подтверждённый контакт живут на одной странице: возобновление списаний требует
 * действующих редакций документов, которые приходят вместе с контактом.
 */
export function BillingAccountView({ options }: BillingAccountViewProps) {
  const [contactState, setContactState] = useState<BillingContactState | null>(
    null,
  );
  return (
    <div className="grid gap-6">
      <BillingCabinetPanel
        contactHref="/account/email"
        options={publicSubscriptionOffers(options)}
        resumeDocuments={contactState?.documents ?? []}
        storefrontHref="/subscription"
      />
      <div className="mx-auto w-full max-w-3xl">
        <BillingContactPanel onStateChange={setContactState} />
      </div>
    </div>
  );
}
