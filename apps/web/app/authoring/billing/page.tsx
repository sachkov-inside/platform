import type { Metadata } from "next";

import { BillingAdminPage } from "@/_pages/billing-admin.server";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Оплата и права · Authoring",
};

export default BillingAdminPage;
