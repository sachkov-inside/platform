import type { Metadata } from "next";

import { AccountPurchasesPage } from "@/_pages/account-purchases";

export const metadata: Metadata = {
  title: "Покупки",
  robots: { follow: false, index: false },
};

export default function AccountPurchasesRoute() {
  return <AccountPurchasesPage />;
}
