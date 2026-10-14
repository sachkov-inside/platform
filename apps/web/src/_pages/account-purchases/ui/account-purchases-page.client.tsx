"use client";
import type { Route } from "next";

import { PurchasesPanel } from "@/features/billing-subscription";
import {
  AccountSectionHeader,
  useSubscriptionOffered,
} from "@/widgets/account-cabinet";

const storefrontHref: Route = "/payment/checkout";

/** Products and their current access stay separate from financial history. */
export function AccountPurchasesPage() {
  // Пока подписку не продают, кабинет не зовёт на витрину, с которой нечего купить.
  const subscriptionOffered = useSubscriptionOffered();

  return (
    <div>
      <AccountSectionHeader section="purchases" />
      <PurchasesPanel
        storefrontHref={subscriptionOffered ? storefrontHref : undefined}
      />
    </div>
  );
}
