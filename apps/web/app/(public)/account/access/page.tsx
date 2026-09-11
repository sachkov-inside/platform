import type { Metadata } from "next";

import { AccountAccessPage } from "@/_pages/account-access";

export const metadata: Metadata = {
  title: "Аккаунт",
};

export default function AccountAccessRoute() {
  return <AccountAccessPage />;
}
