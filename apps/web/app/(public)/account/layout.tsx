import type { ReactNode } from "react";

import { AccountCabinetFrame } from "@/widgets/account-cabinet.server";

export default function AccountLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <AccountCabinetFrame>{children}</AccountCabinetFrame>;
}
