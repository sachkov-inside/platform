import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { desktop, mobile } from "@/storybook/loads-in-place";

import { OrderEmailView } from "./order-email.client";

const shown = fn();
const hidden = fn();
const retried = fn();

const meta = {
  args: {
    onHide: hidden,
    onRetry: retried,
    onShow: shown,
    state: { kind: "hidden" },
  },
  beforeEach: () => {
    shown.mockClear();
    hidden.mockClear();
    retried.mockClear();
  },
  component: OrderEmailView,
  parameters: {
    docs: {
      description: {
        component:
          "Email заказа на странице платежа (#1718): отдельное личное чтение только по «Показать email», без кеша, вне списков, поиска и MCP.",
      },
    },
    layout: "padded",
  },
  id: "pages-authoring-платёж-email-заказа",
  title: "Components/Админка/Продажи/Order email",
} satisfies Meta<typeof OrderEmailView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hidden: Story = {
  globals: desktop.globals,
  name: "Скрыт · широкий экран",
  play: async ({ canvasElement }) => {
    const block = within(canvasElement);
    await expect(block.queryByText(/@/u)).toBeNull();
    await userEvent.click(
      block.getByRole("button", { name: "Показать email" }),
    );
    await expect(shown).toHaveBeenCalledTimes(1);
  },
};

export const HiddenMobile: Story = {
  ...Hidden,
  globals: mobile.globals,
  name: "Скрыт · телефон",
};

export const Loading: Story = {
  args: { state: { kind: "loading" } },
  globals: desktop.globals,
  name: "Читается",
};

export const Shown: Story = {
  args: {
    state: {
      kind: "ready",
      value: { email: "ekaterina.vasilyeva.design-studio@example.test" },
    },
  },
  globals: desktop.globals,
  name: "Показан · широкий экран",
  play: async ({ canvasElement }) => {
    const block = within(canvasElement);
    await expect(
      block.getByText("ekaterina.vasilyeva.design-studio@example.test"),
    ).toBeVisible();
    await userEvent.click(block.getByRole("button", { name: "Скрыть email" }));
    await expect(hidden).toHaveBeenCalledTimes(1);
  },
};

export const ShownMobile: Story = {
  ...Shown,
  globals: mobile.globals,
  name: "Показан · телефон",
};

export const NoEmail: Story = {
  args: { state: { kind: "ready", value: { email: null } } },
  globals: desktop.globals,
  name: "Покупатель не оставил email",
};

export const Forbidden: Story = {
  args: { state: { kind: "forbidden" } },
  globals: desktop.globals,
  name: "Нет права",
};

export const NotFound: Story = {
  args: { state: { kind: "not_found" } },
  globals: mobile.globals,
  name: "Не найден · телефон",
};

export const Unavailable: Story = {
  args: { state: { kind: "unavailable" } },
  globals: mobile.globals,
  name: "Не читается · телефон",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Повторить" }),
    );
    await expect(retried).toHaveBeenCalledTimes(1);
  },
};
