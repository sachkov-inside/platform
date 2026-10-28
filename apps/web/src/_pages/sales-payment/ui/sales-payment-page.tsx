import { Suspense } from "react";

import { SalesPaymentQuery } from "./sales-payment-query.client";
import { SalesPaymentLoading } from "./sales-payment-states";

/** `/authoring/sales/payments/[purchaseRef]`: сервер отдаёт каркас, платёж читает браузер. */
export function SalesPaymentPage({
  params,
}: {
  readonly params: Promise<{ readonly purchaseRef: string }>;
}) {
  return (
    <Suspense fallback={<SalesPaymentLoading />}>
      <SalesPaymentFromParams params={params} />
    </Suspense>
  );
}

async function SalesPaymentFromParams({
  params,
}: {
  readonly params: Promise<{ readonly purchaseRef: string }>;
}) {
  const { purchaseRef } = await params;
  return <SalesPaymentQuery purchaseRef={purchaseRef} />;
}
