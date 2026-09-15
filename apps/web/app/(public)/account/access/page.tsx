import type { Metadata } from "next";

import { AccountAccessRoute } from "@/_pages/account-access.server";

export const metadata: Metadata = {
  title: "Аккаунт",
};

export default function AccountAccessPage() {
  return <AccountAccessRoute />;
}
