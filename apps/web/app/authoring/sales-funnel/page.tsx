import type { Metadata } from "next";

import { SalesFunnelReportPage } from "@/_pages/sales-funnel-report.server";

export const metadata: Metadata = {
  title: "Воронка продаж · Authoring",
};

export default function SalesFunnelRoute({
  searchParams,
}: {
  readonly searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}) {
  return <SalesFunnelReportPage searchParams={searchParams} />;
}
