"use client";
import { BillingContactPanel } from "@/features/billing-contact";
import { PurchasesPanel, useBillingCabinet } from "@/features/billing-subscription";
import { AccountSectionHeader } from "@/widgets/account-cabinet";

/**
 * Раздел «Покупки»: что доступно и по какому основанию, за какие деньги, куда придёт чек и
 * какой картой платим. Подтверждение email живёт здесь же — это часть одной задачи.
 */
export function AccountPurchasesPage() {
  // Завершённая сессия объясняется один раз: форма контакта не повторяет ту же просьбу войти.
  const { sessionExpired } = useBillingCabinet();

  return (
    <div>
      <AccountSectionHeader section="purchases" />
      <div className="grid gap-6">
        <PurchasesPanel storefrontHref="/subscription" />
        {sessionExpired ? null : <BillingContactPanel />}
      </div>
    </div>
  );
}
