import type { Metadata } from "next";

import { AccountSubscriptionPage } from "@/_pages/account-subscription";

export const metadata: Metadata = {
  title: "Подписка",
  robots: { follow: false, index: false },
};

export default function AccountSubscriptionRoute() {
  return <AccountSubscriptionPage />;
}
