import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { flushSync } from "react-dom";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  AuthoringSearchRoot,
  AuthoringSearchTrigger,
} from "./authoring-search.client";

const meta = {
  title: "Components/Админка/AuthoringSearch",
  component: AuthoringSearchRoot,
  args: { children: null },
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} satisfies Meta<typeof AuthoringSearchRoot>;
export default meta;
type Story = StoryObj<typeof meta>;

function RetainedSearch() {
  const [visible, setVisible] = useState(true);
  return (
    <section
      aria-label="Смена сохранённой страницы"
      onKeyDown={(event) => {
        if (event.altKey && event.key === "ArrowRight") {
          event.preventDefault();
          setVisible(false);
        }
      }}
    >
      <button
        onClick={() => {
          setVisible(true);
        }}
        type="button"
      >
        Вернуться к поиску
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        <AuthoringSearchRoot>
          <AuthoringSearchTrigger />
        </AuthoringSearchRoot>
      </Activity>
    </section>
  );
}

export const RetainedLifetime: Story = {
  render: () => <RetainedSearch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /^Поиск по людям/ }),
    );
    const dialog = await canvas.findByRole<HTMLDialogElement>("dialog", {
      name: "Поиск по админке",
    });
    const input = within(dialog).getByRole("combobox", { name: "Что найти" });
    // Whitespace stays an unfinished query: the real query parser disables HTTP.
    await userEvent.type(input, " ");
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуться к поиску" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await expect(canvas.getByRole("dialog", { name: "Поиск по админке" })).toBe(
      dialog,
    );
    await expect(input).toHaveValue(" ");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть поиск" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await userEvent.keyboard("{Control>}k{/Control}");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await expect(
      within(dialog).getByRole("combobox", { name: "Что найти" }),
    ).toHaveValue("");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
  },
};

export const QueuedNativeClose: Story = {
  render: () => (
    <AuthoringSearchRoot>
      <AuthoringSearchTrigger />
    </AuthoringSearchRoot>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /^Поиск по людям/ });
    await userEvent.click(trigger);
    const dialog = await canvas.findByRole<HTMLDialogElement>("dialog", {
      name: "Поиск по админке",
    });
    const close = within(dialog).getByRole("button", { name: "Закрыть поиск" });
    const nativeClose = Promise.withResolvers<undefined>();
    let closeEvents = 0;
    const onClose = () => {
      closeEvents += 1;
      nativeClose.resolve(undefined);
    };
    dialog.addEventListener("close", onClose, { once: true });
    try {
      flushSync(() => {
        close.click();
      });
      const closedBeforeReopen = !dialog.open;
      const deliveredBeforeReopen = closeEvents;
      flushSync(() => {
        trigger.click();
      });
      const reopenedBeforeNativeClose = dialog.matches(":modal");
      await expect(closedBeforeReopen).toBe(true);
      await expect(deliveredBeforeReopen).toBe(0);
      await expect(reopenedBeforeNativeClose).toBe(true);
      await nativeClose.promise;
      await expect(dialog.matches(":modal")).toBe(true);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    } finally {
      dialog.removeEventListener("close", onClose);
    }
  },
};

function ClosedRetainedSearch() {
  const [visible, setVisible] = useState(true);
  return (
    <section>
      <button onClick={() => setVisible(false)} type="button">
        Скрыть поиск
      </button>
      <button onClick={() => setVisible(true)} type="button">
        Вернуться к поиску
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        <AuthoringSearchRoot>
          <AuthoringSearchTrigger />
        </AuthoringSearchRoot>
      </Activity>
    </section>
  );
}

export const ClosedShortcutWhileHidden: Story = {
  render: () => <ClosedRetainedSearch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /^Поиск по людям/ });
    const dialog = canvasElement.querySelector("dialog");
    if (dialog === null) throw new Error("Missing persistent search dialog");
    await expect(dialog.open).toBe(false);
    await expect(dialog.matches(":modal")).toBe(false);
    const outside = canvas.getByRole("button", { name: "Скрыть поиск" });
    await userEvent.click(outside);
    await waitFor(() => expect(trigger).not.toBeVisible());
    await expect(outside).toHaveFocus();
    const hiddenKeys: KeyboardEvent[] = [];
    const recordKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k") hiddenKeys.push(event);
    };
    outside.addEventListener("keydown", recordKey);
    try {
      // Story userEvent delivery, not a trusted physical keyboard assertion.
      await userEvent.keyboard("{Control>}k{/Control}");
      await expect(hiddenKeys).toHaveLength(1);
      const key = hiddenKeys[0];
      if (key === undefined)
        throw new Error("Hidden shortcut was not delivered");
      await expect(key.ctrlKey).toBe(true);
      await expect(key.target).toBe(outside);
      await expect(key.defaultPrevented).toBe(false);
      await expect(dialog.open).toBe(false);
      await userEvent.click(
        canvas.getByRole("button", { name: "Вернуться к поиску" }),
      );
      await waitFor(() => expect(trigger).toBeVisible());
      await expect(canvasElement.querySelector("dialog")).toBe(dialog);
      await expect(dialog.isConnected).toBe(true);
      await expect(dialog.open).toBe(false);
      await expect(dialog.matches(":modal")).toBe(false);
      await userEvent.keyboard("{Control>}k{/Control}");
      await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    } finally {
      outside.removeEventListener("keydown", recordKey);
    }
  },
};
