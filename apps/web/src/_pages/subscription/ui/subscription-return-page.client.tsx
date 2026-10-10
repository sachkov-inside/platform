"use client";
import { PurchaseReturnPanel } from "@/features/billing-checkout";
import { TelegramLinkAction } from "@/features/account-access";
import { announceCurrentBillingChange } from "@/features/billing-subscription";
import { CommunityEntryPanel } from "@/features/community-entry";

export function SubscriptionReturnPage() {
  return (
    <PurchaseReturnPanel
      accessSlot={<CommunityEntryPanel TelegramAction={TelegramLinkAction} />}
      accountHref="/account/subscription"
      onPurchaseConfirmed={announceCurrentBillingChange}
    />
  );
}
