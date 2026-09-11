import type { Metadata } from "next";

import { AccountPurchasesPage } from "@/_pages/account-purchases";

export const metadata: Metadata = {
  title: "Покупки",
};

export default function AccountPurchasesRoute() {
  return <AccountPurchasesPage />;
}
