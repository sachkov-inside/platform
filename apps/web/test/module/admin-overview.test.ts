import { describe, expect, it } from "vitest";

import {
  attentionView,
  canOpenPeople,
  fullFunnelHref,
  funnelStepRows,
  overviewReportSchema,
  productLearnersHref,
  type OverviewAttention,
} from "@/_pages/authoring-overview/model/overview-report";
import {
  overviewQueryHref,
  parseOverviewQuery,
} from "@/_pages/authoring-overview/model/overview-query";
import {
  eventPersonLabel,
  metricChange,
  metricChartSummary,
  metricValueText,
  originBreakdown,
  overviewEventRow,
  parseOverviewPeriod,
  periodLabel,
  productOverviewPeriodSearch,
  progressText,
  type OverviewSeries,
} from "@/features/admin-overview";
import {
  storyOverviewReport,
  storyProductOverview,
} from "@/storybook/admin-overview.fixtures";
import { productOverviewSchema } from "@/features/admin-overview/model/product-overview";

function series(...values: number[]): OverviewSeries {
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    daily: values.map((value, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      value,
    })),
  };
}

describe("metric change against the previous period", () => {
  it("names the change as a signed number with the Russian plural", () => {
    expect(metricChange("sales", series(3, 2), series(1, 2))).toEqual({
      kind: "delta",
      text: "+2 продажи",
      direction: "up",
      meaning: "good",
    });
    expect(metricChange("sales", series(1, 1), series(2, 1))).toEqual({
      kind: "delta",
      text: "−1 продажа",
      direction: "down",
      meaning: "bad",
    });
    expect(metricChange("sales", series(10, 2), series(5, 2))).toMatchObject({
      text: "+5 продаж",
    });
    expect(metricChange("newAccess", series(4), series(1))).toMatchObject({
      text: "+3 доступа",
    });
    expect(metricChange("newAccounts", series(1), series(22))).toMatchObject({
      text: "−21 аккаунт",
      meaning: "bad",
    });
    expect(metricChange("waitlistJoins", series(12), series(1))).toMatchObject({
      text: "+11 записей",
    });
  });

  it("shows revenue in whole rubles without kopecks", () => {
    expect(
      metricChange("revenue", series(2_490_000), series(1_250_050)),
    ).toEqual({
      kind: "delta",
      text: "+12 400 ₽",
      direction: "up",
      meaning: "good",
    });
    expect(metricValueText("revenue", 14_870_049)).toBe("148 700 ₽");
    expect(metricValueText("sales", 1_234)).toBe("1 234");
  });

  it("says «без изменений» for zero and «нет данных» for an empty previous period", () => {
    expect(metricChange("sales", series(2, 0), series(0, 2))).toEqual({
      kind: "delta",
      text: "без изменений",
      direction: "flat",
      meaning: "neutral",
    });
    expect(metricChange("sales", series(5), series(0, 0))).toEqual({
      kind: "no_data",
    });
    expect(metricChange("revenue", series(0), series(0))).toEqual({
      kind: "no_data",
    });
  });

  it("describes the chart in words and names the period", () => {
    expect(periodLabel(7)).toBe("за 7 дней");
    expect(periodLabel(30)).toBe("за 30 дней");
    expect(metricChartSummary("sales", 7, series(1, 4, 0), series(2))).toBe(
      "За 7 дней: 5 продаж. В прошлом периоде: 2 продажи. Больше всего 2 окт: 4 продажи.",
    );
    expect(metricChartSummary("sales", 30, series(0, 0), series(0))).toBe(
      "За 30 дней: 0 продаж. В прошлом периоде данных нет.",
    );
  });

  it("lists only the origins that happened and formats progress", () => {
    expect(
      originBreakdown({
        purchase: 12,
        course_activation: 0,
        manual: 2,
        other: 1,
      }),
    ).toEqual([
      { origin: "purchase", label: "Покупка", count: 12 },
      { origin: "manual", label: "Выдача владельцем", count: 2 },
      { origin: "other", label: "Прочее", count: 1 },
    ]);
    expect(progressText(0.424)).toBe("42 %");
    expect(progressText(null)).toBeNull();
  });
});

describe("overview address", () => {
  it("keeps period and chart metric and omits the defaults", () => {
    expect(parseOverviewQuery(new URLSearchParams())).toEqual({
      period: 30,
      metric: "revenue",
    });
    expect(
      parseOverviewQuery(new URLSearchParams("period=7&metric=sales")),
    ).toEqual({ period: 7, metric: "sales" });
    expect(
      parseOverviewQuery(new URLSearchParams("period=14&metric=refunds")),
    ).toEqual({ period: 30, metric: "revenue" });
    expect(overviewQueryHref({ period: 30, metric: "revenue" })).toBe(
      "/authoring",
    );
    expect(overviewQueryHref({ period: 90, metric: "newAccess" })).toBe(
      "/authoring?period=90&metric=newAccess",
    );
    expect(parseOverviewPeriod("90")).toBe(90);
    expect(parseOverviewPeriod("abc")).toBe(30);
    expect(parseOverviewPeriod(null)).toBe(30);
  });

  it("keeps the product page tab and other parameters when the product period changes", () => {
    expect(productOverviewPeriodSearch("", 7)).toBe("?period=7");
    expect(productOverviewPeriodSearch("?tab=overview&period=7", 30)).toBe(
      "?tab=overview",
    );
    expect(productOverviewPeriodSearch("?period=90", 30)).toBe("");
  });

  it("builds the full funnel report and product learners addresses", () => {
    const productId = "0c1a0000-0000-4000-8000-000000000001";
    expect(fullFunnelHref(productId, 30)).toBe(
      `/authoring/sales/funnel?productId=${productId}`,
    );
    expect(fullFunnelHref(productId, 7)).toBe(
      `/authoring/sales/funnel?productId=${productId}&period=7`,
    );
    expect(productLearnersHref(productId)).toBe(
      `/authoring/products/${productId}?tab=learners`,
    );
  });
});

const allClear: OverviewAttention = {
  undeterminedPayments: { state: "ready", count: 0 },
  fulfillmentIncomplete: { state: "ready", count: 0 },
  communityFailures: { state: "ready", count: 0 },
  telegramDeliveryFailures: { state: "ready", count: 0 },
  submissionsAwaitingFeedback: { state: "ready", count: 0 },
};

describe("«Требует внимания»", () => {
  it("collapses to «Всё в порядке» only when every visible check found nothing", () => {
    expect(attentionView(allClear)).toEqual({
      kind: "all_clear",
      hiddenNote: null,
    });
  });

  it("lists checks with findings as links into filtered lists", () => {
    const view = attentionView({
      ...allClear,
      undeterminedPayments: { state: "ready", count: 3 },
      telegramDeliveryFailures: { state: "ready", count: 1 },
    });
    expect(view).toEqual({
      kind: "rows",
      hiddenNote: null,
      rows: [
        {
          id: "undeterminedPayments",
          kind: "count",
          label: "Оплаты с неизвестным итогом",
          count: 3,
          countText: "3 оплаты",
          href: "/authoring/sales/payments?state=unknown&state=authorized",
        },
        {
          id: "telegramDeliveryFailures",
          kind: "count",
          label: "Сообщения Telegram не доставлены за 30 дней",
          count: 1,
          countText: "1 человек",
          href: "/authoring/people?telegram=delivery_failed",
        },
      ],
    });
  });

  it("never folds an unchecked source into «Всё в порядке»", () => {
    const view = attentionView({
      ...allClear,
      communityFailures: { state: "unavailable" },
    });
    expect(view).toEqual({
      kind: "rows",
      hiddenNote: null,
      rows: [
        {
          id: "communityFailures",
          kind: "unchecked",
          label: "Не удалось проверить доступ к группам Telegram",
        },
      ],
    });
  });

  it("omits forbidden checks and names the right that opens them", () => {
    const materialsOnly = attentionView({
      undeterminedPayments: { state: "forbidden" },
      fulfillmentIncomplete: { state: "forbidden" },
      communityFailures: { state: "forbidden" },
      telegramDeliveryFailures: { state: "forbidden" },
      submissionsAwaitingFeedback: { state: "ready", count: 0 },
    });
    expect(materialsOnly).toEqual({
      kind: "all_clear",
      hiddenNote:
        "Оплаты, выдачу и Telegram проверяет аккаунт с правом управлять доступом и оплатами.",
    });
    expect(
      attentionView({
        ...allClear,
        submissionsAwaitingFeedback: { state: "forbidden" },
        fulfillmentIncomplete: { state: "ready", count: 2 },
      }),
    ).toMatchObject({
      kind: "rows",
      hiddenNote: "Сдачи проверяет аккаунт с правом управлять материалами.",
      rows: [
        {
          href: "/authoring/sales/payments?state=confirmed&fulfillment=incomplete",
        },
      ],
    });
    expect(
      attentionView({
        undeterminedPayments: { state: "forbidden" },
        fulfillmentIncomplete: { state: "forbidden" },
        communityFailures: { state: "forbidden" },
        telegramDeliveryFailures: { state: "forbidden" },
        submissionsAwaitingFeedback: { state: "forbidden" },
      }),
    ).toEqual({ kind: "forbidden" });
  });
});

describe("funnel and events", () => {
  it("keeps a step that is not counted apart from zero", () => {
    expect(
      funnelStepRows({
        entered: 40,
        openedChapter: null,
        checkout: 10,
        paid: 0,
      }),
    ).toEqual([
      { id: "entered", label: "Вход в бот", count: 40, share: 1 },
      { id: "openedChapter", label: "Открыл главу", count: null, share: 0 },
      { id: "checkout", label: "Перешёл к оплате", count: 10, share: 0.25 },
      { id: "paid", label: "Оплатил", count: 0, share: 0 },
    ]);
  });

  it("labels a person by Telegram name, then @username, and never by email", () => {
    const accountId = "0c1a0000-0000-4000-8000-0000000000a1";
    expect(
      eventPersonLabel({ accountId, name: "Анна Петрова", username: "anna" }),
    ).toEqual({ label: "Анна Петрова", named: true });
    expect(
      eventPersonLabel({ accountId, name: " ", username: "anna" }),
    ).toEqual({ label: "@anna", named: true });
    expect(eventPersonLabel({ accountId, name: null, username: null })).toEqual(
      { label: "Без имени в Telegram", named: false },
    );
  });

  it("links the person card only when the viewer may open it", () => {
    const event = {
      kind: "submission",
      occurredAt: "2026-10-24T11:00:00.000Z",
      person: {
        accountId: "0c1a0000-0000-4000-8000-0000000000a1",
        name: "Анна Петрова",
        username: null,
      },
      submissionId: "0c1a0000-0000-4000-8000-0000000000b1",
      commented: false,
      product: null,
      taskTitle: "Ревью кода",
    } as const;
    expect(overviewEventRow(event, { peopleLinks: false })).toMatchObject({
      title: "Новая сдача",
      detail: "Ревью кода",
      person: { label: "Анна Петрова", href: null },
      href: "/authoring/submissions?submission=0c1a0000-0000-4000-8000-0000000000b1",
    });
    expect(overviewEventRow(event, { peopleLinks: true }).person.href).toBe(
      "/authoring/people/0c1a0000-0000-4000-8000-0000000000a1",
    );
    expect(
      canOpenPeople({
        items: [],
        payments: "forbidden",
        access: "forbidden",
        submissions: "ready",
      }),
    ).toBe(false);
    expect(
      canOpenPeople({
        items: [],
        payments: "unavailable",
        access: "forbidden",
        submissions: "ready",
      }),
    ).toBe(true);
  });

  it("accepts the Storybook fixtures as backend responses", () => {
    expect(overviewReportSchema.safeParse(storyOverviewReport()).success).toBe(
      true,
    );
    expect(
      productOverviewSchema.safeParse(storyProductOverview()).success,
    ).toBe(true);
  });
});
