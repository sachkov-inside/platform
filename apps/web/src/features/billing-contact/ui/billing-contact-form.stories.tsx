import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import type { LegalDocument } from "@/entities/subscription";
import { BillingContactForm } from "./billing-contact-form.client";

const contact = {
  email: "buyer@example.test",
  revision: 1,
  verifiedAt: "2026-09-08T12:00:00.000Z",
};
const documents: readonly LegalDocument[] = [
  {
    kind: "terms",
    documentId: "offer",
    version: "2026-09-01",
    digest: "a".repeat(64),
    url: "https://inside.example.test/legal/offer",
    text: "",
  },
  {
    kind: "recurring",
    documentId: "recurring",
    version: "2026-09-01",
    digest: "b".repeat(64),
    url: "https://inside.example.test/legal/recurring",
    text: "",
  },
];

const meta = {
  title: "Pages/Account/Billing contact",
  component: BillingContactForm,
  args: {
    contact: null,
    challenge: null,
    onCancelEdit: fn(),
    onConfirm: fn(),
    onEdit: fn(),
    onRefresh: fn(),
    onStart: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          "Производственная форма контакта #411. Один presentation interface обслуживает маршрут /account/email и оформление подписки.",
      },
    },
  },
} satisfies Meta<typeof BillingContactForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByLabelText("Email", { exact: true }),
      "buyer@example.test",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Получить код" }));
    await expect(args.onStart).toHaveBeenCalledWith("buyer@example.test");
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
  },
};
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  args: { contact, documents },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
export const Loading: Story = { args: { loading: true } };
export const Verified: Story = { args: { contact, verified: true } };
export const ChangeAddress: Story = {
  args: { contact, editing: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Новый email")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Оставить прежний" }),
    ).toBeEnabled();
  },
};
export const Code: Story = {
  args: { challenge: { email: "buyer@example.test", delivery: "sent" } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Код из письма"), "123456");
    await userEvent.click(
      canvas.getByRole("button", { name: "Подтвердить email" }),
    );
    await expect(args.onConfirm).toHaveBeenCalledWith("123456");
  },
};
export const UnknownDelivery: Story = {
  args: { challenge: { email: "buyer@example.test", delivery: "unknown" } },
};
export const RateLimited: Story = {
  args: {
    error: "Слишком много запросов. Подождите перед отправкой нового кода.",
  },
};
export const Pending: Story = {
  args: {
    pending: true,
    challenge: { email: "buyer@example.test", delivery: "sent" },
  },
};
export const SessionExpired: Story = { args: { sessionExpired: true } };
export const Unavailable: Story = {
  args: {
    unavailable: true,
    error: "Подтверждение email сейчас недоступно. Попробуйте позже.",
  },
};
export const LegalDocuments: Story = {
  args: { contact, documents },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: "Согласие на регулярные списания" }),
    ).toHaveAttribute("href", "https://inside.example.test/legal/recurring");
  },
};
