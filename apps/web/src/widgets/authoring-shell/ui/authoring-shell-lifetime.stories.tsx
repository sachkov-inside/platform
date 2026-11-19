import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { flushSync } from "react-dom";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

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

export const FastBreakpointReturn: Story = {
  play: async ({ canvasElement }) => {
    const viewport = Array.from(
      window.parent.document.querySelectorAll("iframe"),
    ).find((frame) => frame === window.frameElement);
    if (viewport === undefined)
      throw new Error("A resizable story viewport is required");
    const previousStyle = viewport.style.cssText;
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Ещё" });
    await userEvent.click(trigger);
    const dialog = canvas.getByRole<HTMLDialogElement>("dialog", {
      name: "Ещё",
    });
    const media = matchMedia("(width >= 64rem)");
    async function crossAndReturn(beforeDelivery?: () => void) {
      const deliveries: boolean[] = [];
      const record = (event: MediaQueryListEvent) => {
        deliveries.push(event.matches);
      };
      let wide = false;
      const returnToMobile = () => {
        wide = media.matches;
        if (wide) {
          viewport.style.setProperty("width", "390px", "important");
          // Flush the new layout before native media-query notifications are delivered.
          void document.documentElement.clientWidth;
          beforeDelivery?.();
        }
      };
      media.addEventListener("change", record);
      window.addEventListener("resize", returnToMobile, { once: true });
      try {
        viewport.style.setProperty("width", "1440px", "important");
        await waitFor(() => expect(deliveries).toContain(false));
        await expect(wide).toBe(true);
      } finally {
        window.removeEventListener("resize", returnToMobile);
        media.removeEventListener("change", record);
      }
    }
    try {
      const resized = new Promise<void>((resolve) => {
        window.addEventListener(
          "resize",
          () => {
            resolve();
          },
          { once: true },
        );
      });
      viewport.style.setProperty("width", "400px", "important");
      await resized;
      await expect(dialog.matches(":modal")).toBe(true);
      await crossAndReturn();
      await expect(dialog.open).toBe(false);
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await crossAndReturn();
      await expect(dialog.open).toBe(false);
      await userEvent.click(trigger);
      const close = within(dialog).getByRole("button", { name: "Закрыть" });
      let closedBeforeReopen = false;
      await crossAndReturn(() => {
        flushSync(() => {
          close.click();
        });
        closedBeforeReopen = !dialog.open;
        flushSync(() => {
          trigger.click();
        });
      });
      await expect(closedBeforeReopen).toBe(true);
      await expect(dialog.matches(":modal")).toBe(true);
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await userEvent.keyboard("{Escape}");
      await expect(trigger).toHaveFocus();
    } finally {
      viewport.style.cssText = previousStyle;
    }
  },
};

export const OpenMenuBreakpointLifetime: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const added = spyOn(MediaQueryList.prototype, "addEventListener");
    const removed = spyOn(MediaQueryList.prototype, "removeEventListener");
    const checkRelease = async (index: number) => {
      await expect(added.mock.calls[index]?.[0]).toBe("change");
      await expect(removed.mock.calls[index]).toEqual(added.mock.calls[index]);
      await expect(removed.mock.contexts[index]).toBe(
        added.mock.contexts[index],
      );
    };
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Ещё" }));
      const dialog = canvas.getByRole<HTMLDialogElement>("dialog", {
        name: "Ещё",
      });
      await expect(added.mock.calls).toHaveLength(1);
      await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
      await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
      await checkRelease(0);
      await userEvent.click(
        canvas.getByRole("button", { name: "Вернуться в админку" }),
      );
      await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
      await expect(added.mock.calls).toHaveLength(2);
      await expect(added.mock.contexts[1]).not.toBe(added.mock.contexts[0]);
      await userEvent.keyboard("{Alt>}{Delete}{/Alt}");
      await waitFor(() => expect(dialog.isConnected).toBe(false));
      await checkRelease(1);
    } finally {
      removed.mockRestore();
      added.mockRestore();
    }
  },
};
