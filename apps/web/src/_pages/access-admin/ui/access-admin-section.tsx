import type { PriceSnapshot } from "@/entities/subscription";
import {
  AccessSummaryPanel,
  InvitationsPanel,
  PeoplePanel,
  TariffsPanel,
} from "@/features/billing-admin";

import { AccessSection } from "./access-section.client";

/**
 * Состав раздела «Доступ»: вкладки, их порядок и панели над одним каталогом владельца. Страница
 * передаёт сюда прочитанный каталог; Storybook показывает тот же состав на данных историй.
 */
export function AccessAdminSection({
  offers,
}: {
  readonly offers: readonly PriceSnapshot[];
}) {
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
