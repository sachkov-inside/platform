import { Suspense } from "react";
import type { Metadata } from "next";

import { SubscriptionReturnPage } from "@/_pages/subscription";

export const metadata: Metadata = {
  title: "Возврат после оплаты",
  robots: { follow: false, index: false },
};

export default function SubscriptionReturnRoute() {
  return (
    <Suspense fallback={<p role="status">Проверяем оплату…</p>}>
      <SubscriptionReturnPage />
    </Suspense>
  );
}
