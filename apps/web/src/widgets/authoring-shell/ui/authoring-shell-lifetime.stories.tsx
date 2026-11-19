import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { flushSync } from "react-dom";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { AuthoringShell } from "./authoring-shell.client";

function RetainedAuthoringShell() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <div
      onKeyDown={(event) => {
        if (event.altKey && event.key === "ArrowRight") {
          event.preventDefault();
          setVisible(false);
        }
        if (event.altKey && event.key === "Delete") {
          event.preventDefault();
          setMounted(false);
        }
      }}
    >
      <button
        onClick={() => {
          setVisible(true);
        }}
        type="button"
      >
        Вернуться в админку
      </button>
      {mounted ? (
        <Activity mode={visible ? "visible" : "hidden"}>
          <AuthoringShell>
            <main id="authoring-content">
              <h1>Проверка навигации</h1>
            </main>
          </AuthoringShell>
        </Activity>
      ) : null}
    </div>
  );
}

const meta = {
  title: "Components/Authoring/Shell lifetime",
  component: RetainedAuthoringShell,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "mobile390", isRotated: false } },
} satisfies Meta<typeof RetainedAuthoringShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RetainedMoreSheet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dock = canvas.getByRole("navigation", { name: "Основные разделы" });
    const more = within(dock).getByRole("button", { name: "Ещё" });
    await userEvent.click(more);
    const dialog = canvas.getByRole<HTMLDialogElement>("dialog", {
      name: "Ещё",
    });
    await expect(dialog.matches(":modal")).toBe(true);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await expect(more).toHaveFocus();
    await userEvent.click(more);
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await expect(dialog.isConnected).toBe(true);
    const returnButton = canvas.getByRole("button", {
      name: "Вернуться в админку",
    });
    await userEvent.click(returnButton);
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await expect(canvas.getByRole("dialog", { name: "Ещё" })).toBe(dialog);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(returnButton).toHaveFocus();
  },
};

export const UnmountedMoreSheet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Ещё" }));
    const dialog = canvas.getByRole<HTMLDialogElement>("dialog", {
      name: "Ещё",
    });
    await expect(dialog.matches(":modal")).toBe(true);
    await userEvent.keyboard("{Alt>}{Delete}{/Alt}");
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await expect(dialog.matches(":modal")).toBe(false);
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуться в админку" }),
    );
    await expect(canvas.queryByRole("dialog", { name: "Ещё" })).toBeNull();
  },
};

export const NativeCloseAfterReopen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const more = canvas.getByRole("button", { name: "Ещё" });
    await userEvent.click(more);
    const dialog = canvas.getByRole<HTMLDialogElement>("dialog", {
      name: "Ещё",
    });
    const close = within(dialog).getByRole("button", {
      name: "Закрыть",
    });
    const deliveredClose = Promise.withResolvers<undefined>();
    let events = 0;
    const onClose = () => {
      events += 1;
      deliveredClose.resolve(undefined);
    };
    dialog.addEventListener("close", onClose, { once: true });
    try {
      flushSync(() => {
        close.click();
      });
      const closed = !dialog.open;
      const eventsBeforeReopen = events;
      flushSync(() => {
        more.click();
      });
      const reopened = dialog.matches(":modal");
      await expect(closed).toBe(true);
      await expect(eventsBeforeReopen).toBe(0);
      await expect(reopened).toBe(true);
      await deliveredClose.promise;
      await expect(dialog.matches(":modal")).toBe(true);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    } finally {
      dialog.removeEventListener("close", onClose);
    }
  },
};
