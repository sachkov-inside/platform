"use client";
import { useQuery } from "@tanstack/react-query";

import type { PriceSnapshot } from "@/entities/subscription";
import { billingContactQueryOptions } from "@/features/billing-contact";
import { SubscriptionPanel } from "@/features/billing-subscription";

export interface AccountSubscriptionViewProps {
  readonly options: readonly PriceSnapshot[];
}

/**
 * Раздел «Подписка». Возобновление списаний требует действующих редакций документов, поэтому
 * они читаются вместе с подтверждённым контактом тем же ключом, что и в разделе «Покупки».
 */
export function AccountSubscriptionView({
  options,
}: AccountSubscriptionViewProps) {
  const contact = useQuery(billingContactQueryOptions());
  const resumeDocuments =
    contact.data?.ok === true ? contact.data.documents : [];

  return (
    <div>
      <header className="mb-8 border-b border-border pb-7">
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
          Подписка
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Тариф, оплаченный срок и следующее списание. Отсюда же отмена,
          возобновление и смена варианта.
        </p>
      </header>

      <SubscriptionPanel
        options={options}
        resumeDocuments={resumeDocuments}
        storefrontHref="/subscription"
      />
    </div>
  );
}
