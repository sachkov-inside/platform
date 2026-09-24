import type { Metadata } from "next";

import { AccountPurchasesPage } from "@/_pages/account-purchases";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = {
  title: "Покупки",
};

export default function AccountPurchasesRoute() {
  return <AccountPurchasesPage />;
}
