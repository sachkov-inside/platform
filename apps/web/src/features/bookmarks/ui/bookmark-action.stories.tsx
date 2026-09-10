import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { BookmarkAction } from "./bookmark-action.client";
import type { BookmarkActionView } from "../model/bookmark-action-view";

function BookmarkProof({ initial = { kind: "ready", bookmarked: false } }: { readonly initial?: BookmarkActionView }) {
  const [view, setView] = useState<BookmarkActionView>(initial);
  const bookmarked = "bookmarked" in view && view.bookmarked;
  const onToggle = (desired: boolean) => {
    setView({ kind: "pending", bookmarked, desired });
    // Fixture response only: production supplies the same presentation interface.
    setTimeout(() => { setView({ kind: "ready", bookmarked: desired }); }, 300);
  };
  return (
    <div className="flex min-h-40 items-start justify-end p-8">
      <BookmarkAction onToggle={onToggle} view={view} />
    </div>
  );
}

const meta = {
  title: "Features/Bookmarks",
  component: BookmarkProof,
  parameters: {
    docs: {
      description: {
        component: "Личная закладка на материал: сохранение, снятие и честные состояния. Реальную запись и доступ поставляет production adapter.",
      },
    },
  },
} satisfies Meta<typeof BookmarkProof>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Save: Story = { args: { initial: { kind: "ready", bookmarked: false } } };
export const Saved: Story = { args: { initial: { kind: "ready", bookmarked: true } } };
export const Anonymous: Story = { args: { initial: { kind: "anonymous", loginHref: "/account" } } };
export const Loading: Story = { args: { initial: { kind: "loading" } } };
export const Pending: Story = { args: { initial: { kind: "pending", bookmarked: false, desired: true } } };
export const SaveFailed: Story = {
  args: { initial: { kind: "error", bookmarked: false, desired: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Не сохранено");
    await expect(canvas.getByRole("button", { name: "В закладки" })).toHaveAttribute("aria-pressed", "false");
  },
};
export const Denied: Story = { args: { initial: { kind: "denied", bookmarked: false } } };
export const Toggle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "В закладки" });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    button.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(canvas.getByRole("button", { name: "В закладках" })).toHaveAttribute("aria-pressed", "true"));
    await expect(canvas.getByRole("button", { name: "В закладках" })).toHaveFocus();
    await userEvent.click(canvas.getByRole("button", { name: "В закладках" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "В закладки" })).toHaveAttribute("aria-pressed", "false"));
  },
};
