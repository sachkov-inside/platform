import type { Meta, StoryObj } from "@storybook/react-vite";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import {
  presentSalesFunnelReport,
  type SalesFunnelReport,
} from "@/_pages/sales-funnel-report/model/sales-funnel-report";
import { SalesFunnelReportProof } from "./sales-funnel-proof";

const productId = "00000000-0000-4000-8000-000000000816";
const chapterId = "00000000-0000-4000-8000-000000000817";

const report: SalesFunnelReport = {
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

const period = { from: "2030-03-01", to: "2030-03-31", corrected: false };

const environment = authoringPageEnvironment("/authoring/sales-funnel");
const meta = {
  ...environment,
  title: "Proofs/1568 AI Engineering/Demand report",
  component: SalesFunnelReportProof,
  args: {
    view: presentSalesFunnelReport(report, period),
    demandState: "ready",
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Изменение текущей поверхности #819: блок спроса на набор. Все числа — вымышленные примеры. Не является приёмкой всей #819. Фильтры сохраняют текущую композицию; запросы не отправляются.",
      },
    },
  },
} satisfies Meta<typeof SalesFunnelReportProof>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const Empty: Story = { args: { demandState: "empty" } };
export const Unavailable: Story = { args: { demandState: "unavailable" } };
