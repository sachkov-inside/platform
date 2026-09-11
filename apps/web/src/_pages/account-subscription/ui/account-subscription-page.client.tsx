"use client";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";

import { billingContactQueryOptions } from "@/features/billing-contact";
import { SubscriptionPanel } from "@/features/billing-subscription";
import {
  AccountSectionHeader,
  useSubscriptionOffered,
  useSubscriptionOptions,
} from "@/widgets/account-cabinet";

const storefrontHref: Route = "/subscription";

/**
 * Раздел «Подписка». Возобновление списаний требует действующих редакций документов, поэтому
 * они читаются вместе с подтверждённым контактом тем же ключом, что и в разделе «Покупки».
 */
export function AccountSubscriptionPage() {
  const options = useSubscriptionOptions();
  // Раздел открывается и по прямому адресу, поэтому выключенную продажу он проверяет сам.
  const subscriptionOffered = useSubscriptionOffered();
  const contact = useQuery(billingContactQueryOptions());
  const resumeDocuments =
    contact.data?.ok === true ? contact.data.documents : [];

  return (
    <div>
      <AccountSectionHeader section="subscription" />
      <SubscriptionPanel
        options={options}
        resumeDocuments={resumeDocuments}
        storefrontHref={subscriptionOffered ? storefrontHref : undefined}
      />
    </div>
  );
}
