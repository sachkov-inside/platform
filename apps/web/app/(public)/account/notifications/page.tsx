import type { Metadata } from "next";

import { AccountNotificationsPage } from "@/_pages/account-notifications";

export const metadata: Metadata = {
  title: "Уведомления",
};

export default function AccountNotificationsRoute() {
  return <AccountNotificationsPage />;
}
