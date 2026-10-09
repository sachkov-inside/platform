import { publicSubscriptionOffers } from "@/entities/subscription";
import { loadViewerBillingOffers } from "@/entities/subscription.server";

import { AccountCabinet } from "./account-cabinet.client";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";

/** Серверный адаптер кабинета: один чтение каталога решает и видимость раздела, и его варианты. */
export async function AccountCabinetFrame({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const result = await loadViewerBillingOffers();
  return (
    <AccountCabinet
      options={publicSubscriptionOffers(
        result.kind === "ready" ? result.offers : [],
      )}
    >
      {/* Кабинету подвал с документами не нужен (решение владельца 09.10.2026). */}
      <HidePublicFooter />
      {children}
    </AccountCabinet>
  );
}
