import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { AccessSummaryView } from "@/features/billing-admin";
import type { AccessSummary } from "@/features/billing-admin/model/access-operations";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/workshop/story-environment";

import { AccessSection } from "./access-section.client";

const environment = authoringPageEnvironment("/authoring/access");
const uuid = (value: string) =>
  `00000000-0000-4000-8000-${value.padStart(12, "0")}`;

/** Выдуманные цифры: настоящая сводка живёт в production БД. */
const summary: AccessSummary = {
  asOf: "2030-03-15T12:00:00.000Z",
  active: [
    { offerId: uuid("103"), name: "Курс", paid: 0, gift: 0, course: 41 },
    {
      offerId: uuid("101"),
      name: "Подписка Inside",
      paid: 128,
      gift: 9,
      course: 0,
    },
  ],
  invitations: {
    issued: 24,
    opened: 19,
    purchaseOpened: 12,
    paid: 8,
    gifted: 5,
    expired: 3,
    revoked: 1,
  },
  attention: [
    {
      accountId: uuid("c01"),
      reason: "payment_failed",
      source: "platform_payment",
      offerId: uuid("101"),
      title: "Подписка Inside",
      at: "2030-03-14T09:00:00.000Z",
    },
    {
      accountId: uuid("c02"),
      reason: "ending",
      source: "invitation",
      offerId: uuid("101"),
      title: "Подписка Inside",
      at: "2030-03-20T21:00:00.000Z",
    },
  ],
  revenue: [
    {
      month: "2030-03",
      offerId: uuid("101"),
      name: "Подписка Inside",
      payments: 31,
      revenueKopecks: 3_069_000,
      refunds: 1,
      refundedKopecks: 99_000,
    },
    {
      month: "2030-02",
      offerId: uuid("101"),
      name: "Подписка Inside",
      payments: 27,
      revenueKopecks: 2_673_000,
      refunds: 0,
      refundedKopecks: 0,
    },
  ],
};

const meta = {
  ...environment,
  title: "Pages/Authoring/Access summary",
  component: AccessSummaryView,
  render: (args) => (
    <AccessSection
      tabs={[
        {
          id: "summary",
          label: "Сводка",
          panel: <AccessSummaryView {...args} />,
        },
      ]}
    />
  ),
  args: { summary, loading: false, error: null },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Раздел «Доступ», вкладка «Сводка»: активные по Offer и курсу, воронка приглашений, " +
          "кому нужно внимание и выручка с возвратами по месяцам.",
      },
    },
  },
} satisfies Meta<typeof AccessSummaryView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Четыре блока сводки с цифрами владельца. */
export const FourBlocks: Story = {
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    for (const title of [
      "Активные",
      "Приглашения",
      "Требуют внимания",
      "Выручка и возвраты",
    ])
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const active = within(
      page.getByRole("table", { name: "Активные по Offer и курсу" }),
    );
    await expect(
      active.getByRole("row", { name: /Подписка Inside 128 9 0/u }),
    ).toBeVisible();
    await expect(page.getByText("Оплатили")).toBeVisible();
    const attention = within(
      page.getByRole("list", { name: "Требуют внимания" }),
    );
    await expect(attention.getByText(/Списание не прошло/u)).toBeVisible();
    await expect(
      attention.getByText(/Доступ до 20 мар\. 2030 г\. включительно/u),
    ).toBeVisible();
    await expect(page.getByText("март 2030 г.")).toBeVisible();
  },
};

export const Quiet: Story = {
  args: {
    summary: {
      ...summary,
      active: [],
      attention: [],
      revenue: [],
    },
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByText("Никому не нужно внимание.")).toBeVisible();
    await expect(page.getByText(/оплат не было/u)).toBeVisible();
  },
};

export const Loading: Story = { args: { summary: null, loading: true } };

export const Unavailable: Story = {
  args: {
    summary: null,
    error: "Данные оплаты сейчас недоступны. Повторите позже.",
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
