import type { Metadata } from "next";

import { AccountSubscriptionPage } from "@/_pages/account-subscription";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = {
  title: "Подписка",
};

export default function AccountSubscriptionRoute() {
  return <AccountSubscriptionPage />;
}
