import { publicSubscriptionOffers } from "@/entities/subscription";
import { loadBillingOffers } from "@/entities/subscription.server";

import { AccountCabinet } from "./account-cabinet.client";

/** Серверный адаптер кабинета: один чтение каталога решает и видимость раздела, и его варианты. */
export async function AccountCabinetFrame({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const result = await loadBillingOffers();
  return (
    <AccountCabinet
      options={publicSubscriptionOffers(
        result.kind === "ready" ? result.offers : [],
      )}
    >
      {children}
    </AccountCabinet>
  );
}
