import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { BookmarkAction } from "./bookmark-action.client";

const meta = {
  title: "Features/Bookmarks",
  component: BookmarkAction,
  args: { onToggle: fn(), view: { kind: "ready", bookmarked: false } },
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Личная закладка на материал: сохранение, снятие и честные состояния. Состояние и запись поставляет production adapter `SavedBookmarkAction`; его путь с сервером показан в «Features/Bookmarks adapter».",
      },
    },
  },
} satisfies Meta<typeof BookmarkAction>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Save: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "В закладки" });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    button.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onToggle).toHaveBeenCalledWith(true);
  },
};
export const Saved: Story = {
  args: { view: { kind: "ready", bookmarked: true } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "В закладках" });
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button);
    await expect(args.onToggle).toHaveBeenCalledWith(false);
  },
};
export const Anonymous: Story = {
  args: { view: { kind: "anonymous", loginHref: "/account" } },
};
export const Loading: Story = { args: { view: { kind: "loading" } } };
export const Pending: Story = {
  args: { view: { kind: "pending", bookmarked: false, desired: true } },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button"));
    await expect(args.onToggle).not.toHaveBeenCalled();
  },
};
export const SaveFailed: Story = {
  args: { view: { kind: "error", bookmarked: false, desired: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Не сохранено");
    await expect(
      canvas.getByRole("button", { name: "В закладки" }),
    ).toHaveAttribute("aria-pressed", "false");
  },
};
export const Denied: Story = {
  args: { view: { kind: "denied", bookmarked: false } },
};
