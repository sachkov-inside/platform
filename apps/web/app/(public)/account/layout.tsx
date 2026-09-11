import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AccountCabinetFrame } from "@/widgets/account-cabinet.server";

/** Личный кабинет закрыт от индексации целиком, включая будущие разделы. */
export const metadata: Metadata = { robots: { follow: false, index: false } };

export default function AccountLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <AccountCabinetFrame>{children}</AccountCabinetFrame>;
}
