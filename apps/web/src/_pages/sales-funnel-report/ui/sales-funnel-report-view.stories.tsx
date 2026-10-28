import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { desktop, mobile } from "@/storybook/loads-in-place";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import {
  presentSalesFunnelReport,
  type SalesFunnelReport,
} from "../model/sales-funnel-report";
import { SalesFunnelReportState } from "./sales-funnel-report-states";
import { SalesFunnelReportView } from "./sales-funnel-report-view.client";

const environment = authoringPageEnvironment("/authoring/sales/funnel");
const productId = "00000000-0000-4000-8000-000000000816";
const chapterId = "00000000-0000-4000-8000-000000000817";

const report: SalesFunnelReport = {
  waitlist: null,
  generatedAt: "2030-04-01T09:00:00.000Z",
  period: {
    from: "2030-02-28T21:00:00.000Z",
    to: "2030-03-31T21:00:00.000Z",
  },
  products: [
    {
      id: productId,
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
  selection: { productId, chapterId },
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

const period = {
  from: "2030-03-01",
  to: "2030-03-31",
  corrected: false,
  preset: null,
};

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
          "Воронка продаж продукта по источникам бота в общем образце списков: продукт, глава и период в адресе, таблица источников, на телефоне список. Согласие на рассылку показано отдельной исторической метрикой, а не шагом.",
      },
    },
  },
} satisfies Meta<typeof SalesFunnelReportView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  globals: desktop.globals,
  name: "Отчёт · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Воронка продаж" }),
    ).toBeVisible();
    const table = page.getByRole("table", { name: "Воронка по источникам" });
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Источник",
      "Вход в бот",
      "Открыл главу",
      "Перешёл к оплате",
      "Оплатил",
    ]);
    await expect(within(table).getByText("survey")).toBeVisible();
    await expect(within(table).getByText("Всего")).toBeVisible();
    await expect(within(table).getAllByText("не измеряется")).toHaveLength(1);
    await expect(
      page.getByRole("combobox", { name: "Глава" }),
    ).toHaveTextContent("Глава 1. Проекты и локальный MCP");
    await expect(
      page.getByRole("heading", { name: "Историческая метрика согласия" }),
    ).toBeVisible();
    const survey = page.getByRole("region", { name: "Респонденты анкеты" });
    await expect(survey).toHaveTextContent("Выдано личных ссылок48");
    await expect(survey).toHaveTextContent("21 из 48 получивших ссылку");
  },
};

export const ReadyMobile: Story = {
  globals: mobile.globals,
  name: "Отчёт · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const list = page.getByRole("list", { name: "Воронка по источникам" });
    await expect(within(list).getByText("survey")).toBeVisible();
    await expect(
      document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ).toBe(true);
  },
};

/** Бот не прислал согласий: исторической метрики нет, шаги воронки те же. */
export const WithoutHistoricalConsent: Story = {
  args: {
    view: presentSalesFunnelReport(
      { ...report, total: { ...report.total, consented: null } },
      period,
    ),
  },
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector("[data-historical-consent]"),
    ).toBeNull();
  },
};

/** Готовый период из фильтра: плашка периода и «Сбросить». */
export const PresetPeriod: Story = {
  args: {
    view: presentSalesFunnelReport(report, {
      from: "2030-03-25",
      to: "2030-03-31",
      corrected: false,
      preset: 7,
    }),
  },
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("combobox", { name: "Период" }),
    ).toHaveTextContent("Последние 7 дней");
    await expect(
      page.getByRole("button", { name: "Убрать фильтр «Последние 7 дней»" }),
    ).toBeVisible();
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
      { ...period, corrected: true, preset: 30 },
    ),
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText("Период задан неверно: показаны последние 30 дней."),
    ).toBeVisible();
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

const waitlist = {
  intakeId: "d4f674dc-a1a9-4f86-8855-e4d904d2845f",
  name: "Следующий набор",
  active: 128,
  joined: 37,
  withdrawn: 4,
  sources: [
    { source: "channel", active: 75, joined: 22, withdrawn: 2 },
    { source: "youtube", active: 32, joined: 8, withdrawn: 1 },
    { source: "survey", active: 15, joined: 5, withdrawn: 1 },
    { source: null, active: 6, joined: 2, withdrawn: 0 },
  ],
  weeks: [
    { from: "2030-03-01", joined: 12, withdrawn: 0 },
    { from: "2030-03-08", joined: 8, withdrawn: 2 },
    { from: "2030-03-15", joined: 10, withdrawn: 1 },
    { from: "2030-03-22", joined: 7, withdrawn: 1 },
  ],
};
export const WaitlistDemand: Story = {
  args: {
    view: presentSalesFunnelReport({ ...report, waitlist }, period),
  },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector("#waitlist-report-title"),
    ).toHaveTextContent("Ожидание набора");
  },
};
export const WaitlistEmpty: Story = {
  args: {
    view: presentSalesFunnelReport(
      {
        ...report,
        waitlist: {
          ...waitlist,
          active: 0,
          joined: 0,
          withdrawn: 0,
          sources: [],
          weeks: [],
        },
      },
      period,
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent(
      "В этом наборе пока нет записей.",
    );
  },
};
