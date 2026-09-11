"use client";
import { useQuery } from "@tanstack/react-query";

import { billingContactQueryOptions } from "@/features/billing-contact";
import { SubscriptionPanel } from "@/features/billing-subscription";
import {
  AccountSectionHeader,
  useSubscriptionOptions,
} from "@/widgets/account-cabinet";

/**
 * Раздел «Подписка». Возобновление списаний требует действующих редакций документов, поэтому
 * они читаются вместе с подтверждённым контактом тем же ключом, что и в разделе «Покупки».
 */
export function AccountSubscriptionPage() {
  const options = useSubscriptionOptions();
  const contact = useQuery(billingContactQueryOptions());
  const resumeDocuments =
    contact.data?.ok === true ? contact.data.documents : [];

  return (
    <div>
      <AccountSectionHeader section="subscription" />
      <SubscriptionPanel
        options={options}
        resumeDocuments={resumeDocuments}
        storefrontHref="/subscription"
      />
    </div>
  );
}
