import type { Metadata } from "next";

import { requireAuthoringEntry } from "@/_app/authoring-entry.server";
import { SalesPaymentPage } from "@/_pages/sales-payment";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = { title: "Платёж · Authoring" };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly purchaseRef: string }>;
}) {
  await requireAuthoringEntry();
  return <SalesPaymentPage params={params} />;
}
