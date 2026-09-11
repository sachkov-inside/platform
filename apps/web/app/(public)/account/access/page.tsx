import type { Metadata } from "next";

import { AccountAccessPage } from "@/_pages/account-access";

export const metadata: Metadata = {
  title: "Аккаунт",
  robots: { follow: false, index: false },
};

export default function AccountAccessRoute() {
  return <AccountAccessPage />;
}
