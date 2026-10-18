import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import {
  individualLink,
  individualSnapshot,
} from "@/storybook/payment-links.fixtures";
import { BillingAdminFrame } from "./billing-admin-frame";
import { PaymentLinksView } from "./payment-links-view.client";
const meta = {
  ...authoringPageEnvironment("/authoring/billing", {
    frame: BillingAdminFrame,
  }),
  title: "Features/Billing/Payment links",
  component: PaymentLinksView,
  args: {
    offers: [individualSnapshot],
    titleFor: () => "AI Engineering",
    links: [],
    issued: null,
    loading: false,
    pending: false,
    hasNext: false,
    onCreate: fn(),
    onRevoke: fn(),
    onRefresh: fn(),
    onMore: fn(),
  },
} satisfies Meta<typeof PaymentLinksView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Create: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/26\s?100\s?₽/u)).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Создать ссылку" }),
    );
    await expect(args.onCreate).toHaveBeenCalledWith({
      paymentOptionId: individualSnapshot.paymentOption.id,
      optionRevision: individualSnapshot.paymentOption.revision,
      price: { kind: "discount", percent: 10 },
      expiresAt: null,
    });
  },
};
export const Issued: Story = {
  args: { issued: individualLink, links: [individualLink] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("heading", { name: "Ссылка создана" }),
    ).toBeVisible();
  },
};
export const AwaitingBank: Story = {
  args: { links: [{ ...individualLink, state: "unknown" }] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", { name: "Отозвать ссылку" }),
    ).toBeDisabled();
  },
};
export const Paid: Story = {
  args: { links: [{ ...individualLink, state: "paid" }] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Покупка завершена", { exact: false }),
    ).toBeVisible();
  },
};
export const Revoked: Story = {
  args: { links: [{ ...individualLink, state: "revoked" }] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/Ссылка отозвана/),
    ).toBeVisible();
  },
};
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Загружаем ссылки…"),
    ).toBeVisible();
  },
};
export const Unavailable: Story = {
  args: { listError: "Не удалось загрузить ссылки. Обновите список." },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toBeVisible();
    await expect(
      within(canvasElement).queryByText("Выданных ссылок пока нет."),
    ).not.toBeInTheDocument();
  },
};
export const NoProducts: Story = {
  args: { offers: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toBeVisible();
  },
};

export const CreateMobile: Story = {
  ...Create,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const IssuedMobile: Story = {
  ...Issued,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
