import type { FunnelReport } from "../read-funnel-report/read-funnel-report.contract.js";

/** Diagnostic response projection: adding an owner report fact must not publish it implicitly. */
export function projectFunnelDiagnosticPage(
  report: FunnelReport,
  page: {
    readonly rows: FunnelReport["rows"];
    readonly nextCursor: string | null;
  },
) {
  return {
    generatedAt: report.generatedAt,
    period: report.period,
    products: report.products,
    selection: report.selection,
    lastBotEventReceivedAt: report.lastBotEventReceivedAt,
    total: report.total,
    surveyRespondents: report.surveyRespondents,
    rows: page.rows,
    nextCursor: page.nextCursor,
    timezone: "Europe/Moscow",
    totalScope: "bounded_cohort",
    coverageScope: "stored_bounded_sources",
    consistency: "independent_owner_snapshots",
    traversal: "live_source",
    coverage:
      report.lastBotEventReceivedAt === null
        ? "partial"
        : page.nextCursor === null
          ? "complete"
          : "paginated",
    freshness: {
      status: "not_proven",
      lastBotEventReceivedAt: report.lastBotEventReceivedAt,
    },
  };
}
