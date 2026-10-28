import { Suspense } from "react";

import { SalesPaymentsLoading } from "./sales-payments-loading";
import { SalesPaymentsPageQuery } from "./sales-payments-page-query.client";

/** `/authoring/sales/payments`: сервер отдаёт каркас, адрес и список читает браузер. */
export function SalesPaymentsPage() {
  return (
    <Suspense fallback={<SalesPaymentsLoading />}>
      <SalesPaymentsPageQuery />
    </Suspense>
  );
}
