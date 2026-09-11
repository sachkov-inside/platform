import { loadBillingOffers } from "@/entities/subscription.server";
import { BillingAdminPanel } from "@/features/billing-admin";

export async function BillingAdminPage() {
  const result = await loadBillingOffers();
  return (
    <BillingAdminPanel
      offers={result.kind === "ready" ? result.offers : []}
    />
  );
}
