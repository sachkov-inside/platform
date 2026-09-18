import type { Metadata } from "next";

import { AccountNotificationsPage } from "@/_pages/account-notifications";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0026). */
export const instant = false;

export const metadata: Metadata = {
  title: "Уведомления",
};

export default function AccountNotificationsRoute() {
  return <AccountNotificationsPage />;
}
