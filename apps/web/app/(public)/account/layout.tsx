import type { ReactNode } from "react";

import { publicSubscriptionOffers } from "@/entities/subscription";
import { loadBillingOffers } from "@/entities/subscription.server";
import { AccountCabinet } from "@/widgets/account-cabinet";

/** Разделы кабинета живут в одной рамке: каталог читается один раз на весь кабинет. */
export default async function AccountLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const result = await loadBillingOffers();
  const offers = publicSubscriptionOffers(
    result.kind === "ready" ? result.offers : [],
  );
  return (
    <AccountCabinet subscriptionOffered={offers.length > 0}>
      {children}
    </AccountCabinet>
  );
}
