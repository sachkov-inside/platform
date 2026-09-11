"use client";
import { BillingContactPanel } from "@/features/billing-contact";
import { PurchasesPanel } from "@/features/billing-subscription";

/**
 * Раздел «Покупки»: что доступно и по какому основанию, за какие деньги, куда придёт чек и
 * какой картой платим. Подтверждение email живёт здесь же — это часть одной задачи.
 */
export function AccountPurchasesPage() {
  return (
    <div>
      <header className="mb-8 border-b border-border pb-7">
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
          Покупки
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Что вам открыто, по какому основанию и до какого срока, а также
          списания, чеки и способ оплаты.
        </p>
      </header>

      <div className="grid gap-6">
        <PurchasesPanel storefrontHref="/subscription" />
        <BillingContactPanel />
      </div>
    </div>
  );
}
