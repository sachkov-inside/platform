import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import {
  presentSalesFunnelReport,
  type SalesFunnelReport,
} from "../model/sales-funnel-report";
import { SalesFunnelReportState } from "./sales-funnel-report-states";
import { SalesFunnelReportView } from "./sales-funnel-report-view";

const environment = authoringPageEnvironment("/authoring/sales-funnel");
const guideId = "00000000-0000-4000-8000-000000000816";
const chapterId = "00000000-0000-4000-8000-000000000817";

const report: SalesFunnelReport = {
  generatedAt: "2030-04-01T09:00:00.000Z",
  period: {
    from: "2030-02-28T21:00:00.000Z",
    to: "2030-03-31T21:00:00.000Z",
  },
  guides: [
    {
      id: guideId,
      name: "Inside AI Engineering",
      chapters: [
        { id: chapterId, name: "Глава 1. Проекты и локальный MCP" },
        {
          id: "00000000-0000-4000-8000-000000000818",
          name: "Глава 2. Агенты",
        },
      ],
    },
  ],
  selection: { guideId, chapterId },
  lastBotEventReceivedAt: "2030-04-01T08:55:00.000Z",
  rows: [
    {
      source: { kind: "label", code: "m_channel" },
      counts: {
        entered: 412,
        consented: 301,
        openedChapter: 188,
        checkout: 42,
        paid: 17,
      },
    },
    {
      source: { kind: "label", code: "m_survey" },
      counts: {
        entered: 96,
        consented: 90,
        openedChapter: 71,
        checkout: 33,
        paid: 21,
      },
    },
    {
      source: { kind: "label", code: "m_youtube" },
      counts: {
        entered: 1280,
        consented: 704,
        openedChapter: 233,
        checkout: 19,
        paid: 6,
      },
    },
    {
      source: { kind: "unlabelled" },
      counts: {
        entered: 57,
        consented: 31,
        openedChapter: 9,
        checkout: 2,
        paid: 1,
      },
    },
    {
      source: { kind: "outside_bot" },
      counts: {
        entered: null,
        consented: null,
        openedChapter: 64,
        checkout: 11,
        paid: 5,
      },
    },
  ],
  total: {
    entered: 1845,
    consented: 1126,
    openedChapter: 565,
    checkout: 107,
    paid: 50,
  },
  surveyRespondents: { uploaded: 312, issued: 48, paid: 21 },
};

const period = { from: "2030-03-01", to: "2030-03-31", corrected: false };

const meta = {
  ...environment,
  title: "Pages/Authoring/Sales funnel report",
  component: SalesFunnelReportView,
  args: { view: presentSalesFunnelReport(report, period) },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Воронка продаж продукта по источникам бота: только общие числа за период.",
      },
    },
  },
} satisfies Meta<typeof SalesFunnelReportView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Воронка продаж" }),
    ).toBeInTheDocument();
    await expect(
      page.getByRole("columnheader", { name: /Оплатил/u }),
    ).toBeInTheDocument();
    await expect(
      page.getByRole("rowheader", { name: "survey" }),
    ).toBeInTheDocument();
    await expect(page.getAllByLabelText("не измеряется")).toHaveLength(2);
    await expect(page.getByRole("combobox", { name: "Глава" })).toHaveValue(
      chapterId,
    );
    const survey = page.getByRole("region", { name: "Респонденты анкеты" });
    await expect(survey).toHaveTextContent("Выдано личных ссылок48");
    await expect(survey).toHaveTextContent("21 из 48 получивших ссылку");
  },
};

/** Список анкеты ещё не загружен (#815): доля недоступна, а не равна нулю. */
export const SurveyListMissing: Story = {
  args: {
    view: presentSalesFunnelReport(
      { ...report, surveyRespondents: null },
      period,
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector("[data-survey-respondents-missing]"),
    ).not.toBeNull();
  },
};

/** До inside-telegram#118 бот ничего не присылает: шаги Platform уже считаются. */
export const BotNotConnected: Story = {
  args: {
    view: presentSalesFunnelReport(
      {
        ...report,
        lastBotEventReceivedAt: null,
        rows: [
          {
            source: { kind: "outside_bot" },
            counts: {
              entered: null,
              consented: null,
              openedChapter: 12,
              checkout: 4,
              paid: 2,
            },
          },
        ],
        total: {
          entered: null,
          consented: null,
          openedChapter: 12,
          checkout: 4,
          paid: 2,
        },
      },
      period,
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector("[data-bot-events='none']"),
    ).not.toBeNull();
  },
};

export const EmptyPeriod: Story = {
  args: {
    view: presentSalesFunnelReport(
      {
        ...report,
        rows: [],
        total: {
          entered: 0,
          consented: 0,
          openedChapter: 0,
          checkout: 0,
          paid: 0,
        },
      },
      { ...period, corrected: true },
    ),
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("status")).toHaveTextContent(
      "показаны последние 30 дней",
    );
    await expect(
      canvasElement.querySelector("[data-report-empty]"),
    ).not.toBeNull();
  },
};

export const Forbidden: Story = {
  render: () => <SalesFunnelReportState kind="forbidden" />,
};

export const Unauthorized: Story = {
  render: () => <SalesFunnelReportState kind="unauthorized" />,
};

export const Unavailable: Story = {
  render: () => <SalesFunnelReportState kind="unavailable" />,
};
