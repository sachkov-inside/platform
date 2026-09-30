"use client";
import { PurchaseReturnPanel } from "@/features/billing-checkout";
import { CommunityEntryPanel } from "@/features/community-entry";

export function SubscriptionReturnPage() {
  return (
    <PurchaseReturnPanel
      accessSlot={<CommunityEntryPanel telegramHref="/account/access" />}
      accountHref="/account/subscription"
    />
  );
}
