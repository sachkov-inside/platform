import type { Metadata } from "next";
import { BillingContactPage } from "@/_pages/billing-contact";
export const metadata: Metadata = {
  title: "Email для чеков и уведомлений",
  robots: { index: false, follow: false },
};
export default function BillingContactRoute() {
  return <BillingContactPage />;
}
