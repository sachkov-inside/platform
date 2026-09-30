import { loadGuideCohorts } from "@/entities/subscription.server";
import { loadBillingOffersForOwner } from "@/features/billing-admin.server";
import { BillingAdminPanel } from "@/features/billing-admin";

export async function BillingAdminPage() {
  const [offers, cohorts] = await Promise.all([
    loadBillingOffersForOwner(),
    loadGuideCohorts(),
  ]);
  return (
    <BillingAdminPanel
      cohorts={cohorts.kind === "ready" ? cohorts.cohorts : null}
      offers={offers}
    />
  );
}
