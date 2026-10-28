import { Suspense } from "react";

import { SalesDiscountsLoading } from "./sales-discounts-loading";
import { SalesDiscountsPageQuery } from "./sales-discounts-page.client";

export function SalesDiscountsPage() {
  return (
    <Suspense fallback={<SalesDiscountsLoading />}>
      <SalesDiscountsPageQuery />
    </Suspense>
  );
}
