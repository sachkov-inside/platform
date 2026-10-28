import type { Metadata } from "next";

import { SalesPaymentPage } from "@/_pages/sales-payment";

export const metadata: Metadata = { title: "Платёж · Authoring" };

export default function Page({
  params,
}: {
  readonly params: Promise<{ readonly purchaseRef: string }>;
}) {
  return <SalesPaymentPage params={params} />;
}
