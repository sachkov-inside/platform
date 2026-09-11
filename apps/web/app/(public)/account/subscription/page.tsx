import type { Metadata } from "next";

import { BillingAccountPage } from "@/_pages/billing-account.server";

export const metadata: Metadata = {
  title: "Платёжный кабинет",
  robots: { follow: false, index: false },
};

export default function BillingAccountRoute() {
  return <BillingAccountPage />;
}
