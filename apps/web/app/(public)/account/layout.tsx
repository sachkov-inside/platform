import type { Metadata } from "next";
import type { ReactNode } from "react";

import { redirectUntilTermsAccepted } from "@/features/terms-acceptance.server";
import { AccountCabinetFrame } from "@/widgets/account-cabinet.server";

/** Личный кабинет закрыт от индексации целиком, включая будущие разделы. */
export const metadata: Metadata = { robots: { follow: false, index: false } };

export default async function AccountLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  // Кабинет открывается после принятия действующей редакции условий на экране первого входа.
  await redirectUntilTermsAccepted("/account");
  return <AccountCabinetFrame>{children}</AccountCabinetFrame>;
}
