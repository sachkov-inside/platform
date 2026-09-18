import type { Metadata } from "next";
import { AccountPageQuery } from "@/_pages/account";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0026). */
export const instant = false;

export const metadata: Metadata = {
  title: "Профиль",
};

export default function AccountRoute() {
  return <AccountPageQuery />;
}
