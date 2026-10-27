import { loadSalesFunnelReport } from "../api/sales-funnel-report.server";
import {
  parseSalesFunnelQuery,
  periodParams,
  type SalesFunnelSearchParams,
} from "../model/sales-funnel-query";
import { SalesFunnelReportState } from "./sales-funnel-report-states";
import { SalesFunnelReportView } from "./sales-funnel-report-view.client";

export async function SalesFunnelReportPage({
  searchParams,
}: {
  readonly searchParams: Promise<SalesFunnelSearchParams>;
}) {
  const query = parseSalesFunnelQuery(await searchParams);
  const outcome = await loadSalesFunnelReport({
    ...periodParams(query.period),
    ...(query.productId === null ? {} : { productId: query.productId }),
    ...(query.chapterId === null ? {} : { chapterId: query.chapterId }),
  });
  return outcome.kind === "ready" ? (
    <SalesFunnelReportView view={outcome.view} />
  ) : (
    <SalesFunnelReportState kind={outcome.kind} />
  );
}
