import { Suspense } from "react";

import { SalesLinksLoading } from "./sales-links-loading";
import { SalesLinksPageQuery } from "./sales-links-page.client";

export function SalesLinksPage() {
  return (
    <Suspense fallback={<SalesLinksLoading />}>
      <SalesLinksPageQuery />
    </Suspense>
  );
}
