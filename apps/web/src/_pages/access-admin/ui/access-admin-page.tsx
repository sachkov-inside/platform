import { loadBillingOffersForOwner } from "@/features/billing-admin.server";
import {
  AccessSummaryPanel,
  InvitationsPanel,
  PeoplePanel,
  TariffsPanel,
} from "@/features/billing-admin";

import { AccessSection } from "./access-section.client";

/** Раздел «Доступ»: каталог владельца читается один раз и нужен вкладкам для названий предложений. */
export async function AccessAdminPage() {
  const offers = await loadBillingOffersForOwner();
  return (
    <AccessSection
      tabs={[
        {
          id: "tariffs",
          label: "Тарифы",
          panel: <TariffsPanel offers={offers} />,
        },
        {
          id: "invitations",
          label: "Приглашения",
          panel: <InvitationsPanel offers={offers} />,
        },
        {
          id: "people",
          label: "Люди и доступ",
          panel: <PeoplePanel offers={offers} />,
        },
        {
          id: "summary",
          label: "Сводка",
          panel: <AccessSummaryPanel />,
        },
      ]}
    />
  );
}
