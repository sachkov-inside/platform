import { describe, expect, it } from "vitest";

import {
  presentSalesFunnelReport,
  readReportPeriod,
  type SalesFunnelReport,
} from "@/_pages/sales-funnel-report/model/sales-funnel-report";

// 23:30 UTC is already the next day in Moscow: the period follows the owner's calendar.
const now = new Date("2030-03-31T23:30:00.000Z");

describe("sales funnel report period", () => {
  it("defaults to the last thirty Moscow days including today", () => {
    expect(readReportPeriod({}, now)).toEqual({
      from: "2030-03-03",
      to: "2030-04-01",
      query: {
        from: "2030-03-02T21:00:00.000Z",
        to: "2030-04-01T21:00:00.000Z",
      },
      corrected: false,
    });
  });

  it("includes the last chosen day and turns dates into Moscow instants", () => {
    expect(
      readReportPeriod({ from: "2030-03-01", to: "2030-03-01" }, now).query,
    ).toEqual({
      from: "2030-02-28T21:00:00.000Z",
      to: "2030-03-01T21:00:00.000Z",
    });
  });

  it("replaces a reversed or malformed period and says so", () => {
    for (const params of [
      { from: "2030-03-10", to: "2030-03-01" },
      { from: "yesterday", to: "2030-03-01" },
      { from: "2030-03-01" },
    ])
      expect(readReportPeriod(params, now)).toMatchObject({
        from: "2030-03-03",
        to: "2030-04-01",
        corrected: true,
      });
  });
});

describe("sales funnel report presentation", () => {
  const report: SalesFunnelReport = {
    generatedAt: "2030-04-01T09:00:00.000Z",
    period: {
      from: "2030-02-28T21:00:00.000Z",
      to: "2030-03-31T21:00:00.000Z",
    },
    products: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Inside AI Engineering",
        chapters: [
          { id: "00000000-0000-4000-8000-000000000002", name: "Глава 1" },
        ],
      },
    ],
    selection: {
      productId: "00000000-0000-4000-8000-000000000001",
      chapterId: "00000000-0000-4000-8000-000000000002",
    },
    lastBotEventReceivedAt: null,
    rows: [
      {
        source: { kind: "label", code: "m_survey" },
        counts: {
          entered: 5,
          consented: 4,
          openedChapter: 3,
          checkout: 2,
          paid: 1,
        },
      },
      {
        source: { kind: "label", code: "site" },
        counts: {
          entered: 1,
          consented: 0,
          openedChapter: 0,
          checkout: 0,
          paid: 0,
        },
      },
      {
        source: { kind: "outside_bot" },
        counts: {
          entered: null,
          consented: null,
          openedChapter: 2,
          checkout: 1,
          paid: 1,
        },
      },
    ],
    total: { entered: 6, consented: 4, openedChapter: 5, checkout: 3, paid: 2 },
    surveyRespondents: { uploaded: 40, issued: 12, paid: 3 },
  };

  it("names sources in owner words and keeps unmeasured steps apart from zero", () => {
    const view = presentSalesFunnelReport(report, {
      from: "2030-03-01",
      to: "2030-03-31",
      corrected: false,
    });
    const values = (counts: readonly { readonly value: number | null }[]) =>
      counts.map((count) => count.value);
    expect(
      view.rows.map((row) => [row.key, row.label, values(row.counts)]),
    ).toEqual([
      ["label:m_survey", "survey", [5, 4, 3, 2, 1]],
      ["label:site", "site", [1, 0, 0, 0, 0]],
      ["outside_bot", "Не через бота", [null, null, 2, 1, 1]],
    ]);
    expect(view.rows[0]?.counts[4]).toEqual({ step: "paid", value: 1 });
    expect(values(view.total)).toEqual([6, 4, 5, 3, 2]);
    expect(view.chapterName).toBe("Глава 1");
    expect(view.lastBotEventAt).toBeNull();
    expect(view.generatedAt).toBe("1 апреля 2030 г. в 12:00");
  });

  const period = { from: "2030-03-01", to: "2030-03-31", corrected: false };

  it("shows the share of survey respondents who bought through their personal link", () => {
    const { surveyRespondents } = presentSalesFunnelReport(report, period);
    expect(surveyRespondents).toMatchObject({
      uploaded: 40,
      issued: 12,
      paid: 3,
    });
    expect(surveyRespondents?.share?.percent).toMatch(/^25\s%$/u);
    expect(surveyRespondents?.share?.basis).toBe("3 из 12");
  });

  it("keeps a missing survey list or an unmeasured share apart from zero", () => {
    expect(
      presentSalesFunnelReport({ ...report, surveyRespondents: null }, period)
        .surveyRespondents,
    ).toBeNull();
    for (const surveyRespondents of [
      { uploaded: 40, issued: 0, paid: 0 },
      { uploaded: 40, issued: 12, paid: null },
    ])
      expect(
        presentSalesFunnelReport({ ...report, surveyRespondents }, period)
          .surveyRespondents?.share,
      ).toBeNull();
  });
});
