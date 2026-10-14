"use client";
import { Suspense } from "react";
import {
  PurchaseReturnPanel,
  PurchaseReturnView,
} from "@/features/billing-checkout";
import { announceCurrentBillingChange } from "@/features/billing-subscription";

export function SubscriptionReturnLoading() {
  return (
    <div className="min-h-svh">
      <PurchaseReturnView
        purchase={null}
        loading
        accountHref="/account/purchases"
        onRefresh={() => undefined}
      />
    </div>
  );
}
export function SubscriptionReturnPage() {
  return (
    <Suspense fallback={<SubscriptionReturnLoading />}>
      <div className="min-h-svh">
        <PurchaseReturnPanel
          accountHref="/account/purchases"
          onPurchaseConfirmed={announceCurrentBillingChange}
        />
      </div>
    </Suspense>
  );
}
