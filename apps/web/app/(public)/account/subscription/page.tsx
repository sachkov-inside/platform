import type { Metadata } from "next";

import { AccountSubscriptionPage } from "@/_pages/account-subscription.server";

export const metadata: Metadata = {
  title: "Подписка",
  robots: { follow: false, index: false },
};

export default function AccountSubscriptionRoute() {
  return <AccountSubscriptionPage />;
}
