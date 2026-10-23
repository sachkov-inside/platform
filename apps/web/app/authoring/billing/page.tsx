import type { Metadata } from "next";

import { Suspense } from "react";
import {
  BillingAdminLoading,
  BillingAdminPage,
} from "@/_pages/billing-admin.server";

export const metadata: Metadata = {
  title: "Оплата и права · Authoring",
};

export default function BillingRoute() {
  return (
    <Suspense fallback={<BillingAdminLoading />}>
      <BillingAdminPage />
    </Suspense>
  );
}
