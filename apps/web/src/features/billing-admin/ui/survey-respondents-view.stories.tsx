import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { authoringPageEnvironment } from "@/storybook/story-environment";

import { BillingAdminFrame } from "./billing-admin-frame";
import { SurveyRespondentsView } from "./survey-respondents-view.client";

const environment = authoringPageEnvironment("/authoring/billing", {
  frame: BillingAdminFrame,
});
/** Только выдуманные ники: настоящий список живёт в production БД. */
const data = {
  total: 3,
  issued: 2,
  purchased: 1,
  respondents: [
    {
      username: "synthetic_alpha",
      issuedAt: "2030-03-31T10:00:00.000Z",
      purchased: true,
    },
    {
      username: "synthetic_beta",
      issuedAt: "2030-04-01T09:00:00.000Z",
      purchased: false,
    },
    { username: "synthetic_gamma", issuedAt: null, purchased: false },
  ],
};
const meta = {
  ...environment,
  title: "Features/Billing/Survey respondents",
  component: SurveyRespondentsView,
  args: {
    data,
    loading: false,
    error: null,
    onRefresh: fn(),
  },
} satisfies Meta<typeof SurveyRespondentsView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The archive keeps historical facts and directs new issuance to common payment links. */
export const Summary: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Архив анкетных скидок" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "«Ссылки на оплату»" }),
    ).toHaveAttribute("href", "#payment-links");
    await expect(
      canvas.queryByRole("button", { name: "Выдать ссылку" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByLabelText("Telegram-ник"),
    ).not.toBeInTheDocument();
  },
};
export const Loading: Story = {
  args: { data: null, loading: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toBeVisible();
  },
};
export const Unavailable: Story = {
  args: { data: null, error: "Не удалось прочитать архив." },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toBeVisible();
  },
};
export const Empty: Story = {
  args: { data: { total: 0, issued: 0, purchased: 0, respondents: [] } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("В архиве пока нет анкетных ссылок."),
    ).toBeVisible();
  },
};
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
