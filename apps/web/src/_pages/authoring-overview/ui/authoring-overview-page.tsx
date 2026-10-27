import { Suspense } from "react";

import { AuthoringOverviewLoading } from "./authoring-overview-loading";
import { AuthoringOverviewPageQuery } from "./authoring-overview-page-query.client";

export { AuthoringOverviewLoading };

/** `/authoring`: период и показатель графика живут в адресе, Обзор читает браузер. */
export function AuthoringOverviewPage() {
  return (
    <Suspense fallback={<AuthoringOverviewLoading />}>
      <AuthoringOverviewPageQuery />
    </Suspense>
  );
}
