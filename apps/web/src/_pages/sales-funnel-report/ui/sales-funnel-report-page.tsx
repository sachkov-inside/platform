import { loadSalesFunnelReport } from "../api/sales-funnel-report.server";
import { SalesFunnelReportState } from "./sales-funnel-report-states";
import { SalesFunnelReportView } from "./sales-funnel-report-view";

type SearchValue = string | string[] | undefined;

function single(value: SearchValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function SalesFunnelReportPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, SearchValue>>>;
}) {
  const params = await searchParams;
  const from = single(params["from"]);
  const to = single(params["to"]);
  const guideId = single(params["guideId"]);
  const chapterId = single(params["chapterId"]);
  const outcome = await loadSalesFunnelReport({
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(guideId === undefined ? {} : { guideId }),
    ...(chapterId === undefined ? {} : { chapterId }),
  });
  return outcome.kind === "ready" ? (
    <SalesFunnelReportView view={outcome.view} />
  ) : (
    <SalesFunnelReportState kind={outcome.kind} />
  );
}
