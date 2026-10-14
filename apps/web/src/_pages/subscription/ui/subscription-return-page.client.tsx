"use client";
import { PurchaseReturnPanel } from "@/features/billing-checkout";
import { announceCurrentBillingChange } from "@/features/billing-subscription";

export function SubscriptionReturnPage() {
  return (
    <PurchaseReturnPanel
      accountHref="/account/purchases"
      onPurchaseConfirmed={announceCurrentBillingChange}
    />
  );
}
