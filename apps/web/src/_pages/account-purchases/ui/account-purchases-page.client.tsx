"use client";
import type { Route } from "next";

import { BillingContactPanel } from "@/features/billing-contact";
import { PurchasesPanel, useBillingSessionExpired } from "@/features/billing-subscription";
import {
  AccountSectionHeader,
  useSubscriptionOffered,
} from "@/widgets/account-cabinet";

const storefrontHref: Route = "/subscription";

/**
 * Раздел «Покупки»: что доступно и по какому основанию, куда придёт чек, какой картой платим
 * и что уже списано. Подтверждение email живёт здесь же — это часть одной задачи.
 */
export function AccountPurchasesPage() {
  // Завершённая сессия объясняется один раз: форма контакта не повторяет ту же просьбу войти.
  const sessionExpired = useBillingSessionExpired();
  // Пока подписку не продают, кабинет не зовёт на витрину, с которой нечего купить.
  const subscriptionOffered = useSubscriptionOffered();

  return (
    <div>
      <AccountSectionHeader section="purchases" />
      <PurchasesPanel
        {...(sessionExpired ? {} : { contactSlot: <BillingContactPanel /> })}
        storefrontHref={subscriptionOffered ? storefrontHref : undefined}
      />
    </div>
  );
}
