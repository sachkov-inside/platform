"use client";
import { BillingContactPanel } from "@/features/billing-contact";
import { PurchasesPanel, useBillingSessionExpired } from "@/features/billing-subscription";
import { AccountSectionHeader } from "@/widgets/account-cabinet";

/**
 * Раздел «Покупки»: что доступно и по какому основанию, куда придёт чек, какой картой платим
 * и что уже списано. Подтверждение email живёт здесь же — это часть одной задачи.
 */
export function AccountPurchasesPage() {
  // Завершённая сессия объясняется один раз: форма контакта не повторяет ту же просьбу войти.
  const sessionExpired = useBillingSessionExpired();

  return (
    <div>
      <AccountSectionHeader section="purchases" />
      <PurchasesPanel
        {...(sessionExpired ? {} : { contactSlot: <BillingContactPanel /> })}
        storefrontHref="/subscription"
      />
    </div>
  );
}
