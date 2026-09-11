import { loadBillingOffersForOwner } from "@/features/billing-admin.server";
import { BillingAdminPanel } from "@/features/billing-admin";

export async function BillingAdminPage() {
  const offers = await loadBillingOffersForOwner();
  return <BillingAdminPanel offers={offers} />;
}
