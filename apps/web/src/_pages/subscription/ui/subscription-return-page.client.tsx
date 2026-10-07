"use client";
import { PurchaseReturnPanel } from "@/features/billing-checkout";
import { TelegramLinkAction } from "@/features/account-access";
import { CommunityEntryPanel } from "@/features/community-entry";

export function SubscriptionReturnPage() {
  return (
    <PurchaseReturnPanel
      accessSlot={<CommunityEntryPanel TelegramAction={TelegramLinkAction} />}
      accountHref="/account/subscription"
    />
  );
}
