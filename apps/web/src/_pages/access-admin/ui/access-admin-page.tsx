import { loadBillingOffersForOwner } from "@/features/billing-admin.server";
import { InvitationsPanel } from "@/features/billing-admin";

import { AccessSection } from "./access-section.client";

/** Раздел «Доступ»: каталог владельца читается один раз и нужен вкладкам для названий предложений. */
export async function AccessAdminPage() {
  const offers = await loadBillingOffersForOwner();
  return (
    <AccessSection
      tabs={[
        {
          id: "invitations",
          label: "Приглашения",
          panel: <InvitationsPanel offers={offers} />,
        },
      ]}
    />
  );
}
