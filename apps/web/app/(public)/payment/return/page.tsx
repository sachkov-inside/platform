import type { Metadata } from "next";

import { SubscriptionReturnPage } from "@/_pages/subscription";

export const metadata: Metadata = {
  title: "Возврат после оплаты",
  robots: { follow: false, index: false },
};

export default function SubscriptionReturnRoute() {
  return <SubscriptionReturnPage />;
}
