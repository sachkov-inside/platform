import { loadBillingOffersForOwner } from "@/features/billing-admin.server";

import { AccessAdminSection } from "./access-admin-section";

/** Раздел «Доступ»: каталог владельца читается один раз и нужен вкладкам для названий предложений. */
export async function AccessAdminPage() {
  const offers = await loadBillingOffersForOwner();
  return <AccessAdminSection offers={offers} />;
}
