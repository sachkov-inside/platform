import type { Metadata } from "next";

import { AccountAccessRoute } from "@/_pages/account-access.server";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = {
  title: "Аккаунт",
};

export default function AccountAccessPage() {
  return <AccountAccessRoute />;
}
