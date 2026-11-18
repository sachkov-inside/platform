import { Activity, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import {
  MaterialBodyView,
  type MaterialBodyRendering,
} from "@/entities/material";

const term = {
  id: "lifetime-contract",
  title: "Понятие проверки",
  englishTitle: null,
  shortDefinition: "Короткое определение для проверки подсказки.",
  fullDefinition:
    "Полное определение сохраняется при возврате.\n\nВторой абзац меняет высоту подсказки.",
};
const rendering: MaterialBodyRendering = {
  headingId: (path) => `glossary-lifetime-${path.join("-")}`,
  image: () => null,
  file: () => null,
  glossary: new Map([[term.id, term]]),
};

function RetainedGlossary() {
  const [hidden, setHidden] = useState(false);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button
        onClick={() => {
          setHidden(true);
        }}
        type="button"
      >
        Скрыть текст
      </button>
      <button
        onClick={() => {
          setHidden(false);
        }}
        type="button"
      >
        Вернуть текст
      </button>
      <button
        onClick={() => {
          setMounted(false);
        }}
        type="button"
      >
        Убрать текст
      </button>
      {mounted ? (
        <Activity mode={hidden ? "hidden" : "visible"}>
          <div style={{ paddingTop: 200 }}>
            <MaterialBodyView
              blocks={[
                {
                  kind: "paragraph",
                  content: [
                    {
                      kind: "text",
                      text: "понятие",
                      marks: [{ kind: "link", href: `term:${term.id}` }],
                    },
                  ],
                },
              ]}
              path={[]}
              rendering={rendering}
            />
          </div>
        </Activity>
      ) : null}
    </>
  );
}

const meta = {
  title: "Components/Material/Glossary lifetime",
  component: RetainedGlossary,
} satisfies Meta<typeof RetainedGlossary>;
export default meta;
type Story = StoryObj<typeof meta>;

async function activateByKeyboard(button: HTMLElement) {
  button.focus();
  await userEvent.keyboard("{Enter}");
}

export const RetainedPinnedDefinition: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const added = spyOn(document, "addEventListener");
    const removed = spyOn(document, "removeEventListener");
    const observed = spyOn(ResizeObserver.prototype, "observe");
    const disconnected = spyOn(ResizeObserver.prototype, "disconnect");
    try {
      const trigger = canvas.getByRole("button", { name: "понятие" });
      await userEvent.click(trigger);
      const bubble = await page.findByRole("dialog", { name: term.title });
      await userEvent.click(
        within(bubble).getByRole("button", { name: "Подробнее" }),
      );
      await expect(bubble).toHaveTextContent(
        "Полное определение сохраняется при возврате.",
      );
      const scrollLease = added.mock.calls
        .filter(([kind]) => kind === "scroll")
        .at(-1);
      const observerIndex = observed.mock.calls.findLastIndex(
        ([element]) => element === bubble,
      );
      await expect(scrollLease).toBeDefined();
      await expect(observerIndex).toBeGreaterThanOrEqual(0);
      if (scrollLease === undefined || observerIndex < 0)
        throw new Error("No glossary browser resource acquired");
      const resizeOwner = observed.mock.contexts[observerIndex];
      // A keyboard action hides the retained page without an outside pointer dismissal.
      await activateByKeyboard(
        canvas.getByRole("button", { name: "Скрыть текст" }),
      );
      await waitFor(() => expect(trigger).not.toBeVisible());
      await expect(bubble).not.toBeVisible();
      await expect(trigger.isConnected && bubble.isConnected).toBe(true);
      await expect(
        removed.mock.calls.some(
          ([kind, listener, options]) =>
            kind === "scroll" &&
            listener === scrollLease[1] &&
            options === scrollLease[2],
        ),
      ).toBe(true);
      await expect(disconnected.mock.contexts.includes(resizeOwner)).toBe(true);
      await activateByKeyboard(
        canvas.getByRole("button", { name: "Вернуть текст" }),
      );
      await waitFor(() => expect(trigger).toBeVisible());
      await expect(page.getByRole("dialog", { name: term.title })).toBe(bubble);
      await expect(bubble).toHaveTextContent(
        "Полное определение сохраняется при возврате.",
      );
      await userEvent.keyboard("{Escape}");
      await waitFor(() =>
        expect(page.queryByRole("dialog", { name: term.title })).toBeNull(),
      );
      await expect(trigger).toHaveFocus();
      await userEvent.click(trigger);
      await expect(
        await page.findByRole("dialog", { name: term.title }),
      ).not.toHaveTextContent("Полное определение сохраняется при возврате.");
      await activateByKeyboard(
        canvas.getByRole("button", { name: "Убрать текст" }),
      );
      await waitFor(() =>
        expect(page.queryByRole("dialog", { name: term.title })).toBeNull(),
      );
      await expect(trigger.isConnected).toBe(false);
    } finally {
      added.mockRestore();
      removed.mockRestore();
      observed.mockRestore();
      disconnected.mockRestore();
    }
  },
};

export const PendingHoverReleasedOnHide: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "понятие" });
    // Same-task synthetic pointer inputs expose pending hover ownership, not trusted mouse proof.
    trigger.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
    );
    trigger.dispatchEvent(
      new PointerEvent("pointerenter", { pointerType: "mouse" }),
    );
    canvas.getByRole("button", { name: "Скрыть текст" }).click();
    await waitFor(() => expect(trigger).not.toBeVisible());
    // Intentional absence check beyond the existing100ms hover delay (#2419).
    await new Promise((resolve) => setTimeout(resolve, 250));
    await activateByKeyboard(
      canvas.getByRole("button", { name: "Вернуть текст" }),
    );
    await waitFor(() => expect(trigger).toBeVisible());
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.queryByRole("dialog", { name: term.title })).toBeNull();
    await userEvent.hover(trigger);
    await expect(
      await page.findByRole("dialog", { name: term.title }),
    ).toBeVisible();
    await userEvent.unhover(trigger);
    await waitFor(() =>
      expect(page.queryByRole("dialog", { name: term.title })).toBeNull(),
    );
  },
};
