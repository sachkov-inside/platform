import type { Metadata } from "next";

import { AccountNotificationsPage } from "@/_pages/account-notifications";

export const metadata: Metadata = {
  title: "Уведомления",
  robots: { follow: false, index: false },
};

export default function AccountNotificationsRoute() {
  return <AccountNotificationsPage />;
}
