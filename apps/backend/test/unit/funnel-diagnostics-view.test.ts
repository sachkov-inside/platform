import { expect, it } from "vitest";
import { projectFunnelDiagnosticPage } from "../../src/modules/sales-funnel/features/read-funnel-diagnostics/funnel-diagnostics-view.js";

it("does not publish a future private owner report field in the diagnostic response", () => {
  const report = {
    generatedAt: "2026-10-19T12:00:00.000Z",
    period: {
      from: "2026-10-18T21:00:00.000Z",
      to: "2026-10-19T21:00:00.000Z",
    },
    products: [],
    selection: null,
    lastBotEventReceivedAt: null,
    rows: [],
    total: {
      entered: null,
      consented: null,
      openedChapter: null,
      checkout: null,
      paid: null,
    },
    surveyRespondents: null,
    futurePrivateField: "private-owner-sentinel",
  };
  const response = projectFunnelDiagnosticPage(report, {
    rows: [],
    nextCursor: null,
  });
  expect(response).not.toHaveProperty("futurePrivateField");
  expect(Object.keys(response).sort()).toEqual([
    "consistency",
    "coverage",
    "coverageScope",
    "freshness",
    "generatedAt",
    "lastBotEventReceivedAt",
    "nextCursor",
    "period",
    "products",
    "rows",
    "selection",
    "surveyRespondents",
    "timezone",
    "total",
    "totalScope",
    "traversal",
  ]);
});
