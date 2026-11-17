import { currentLegalEdition } from "@inside/legal";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useCallback, useState } from "react";
import { flushSync } from "react-dom";
import { expect, waitFor, within } from "storybook/test";

import {
  legalDocumentPath,
  legalEditionPath,
} from "@/shared/routing/public-page-path";
import { Button } from "@/shared/ui/button";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { WelcomeDialog } from "./welcome-dialog.client";
import { WelcomeView } from "./welcome-view";

const terms = currentLegalEdition("terms");
const environment = publicPageEnvironment("/welcome", {
  account: "authenticated",
});

function RetainedWelcome() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [closeEvents, setCloseEvents] = useState(0);
  const observeClose = useCallback((element: HTMLDivElement | null) => {
    if (element === null) return;
    const record = (event: Event) => {
      if (event.target instanceof HTMLDialogElement)
        setCloseEvents((count) => count + 1);
    };
    element.addEventListener("close", record, true);
    return () => {
      element.removeEventListener("close", record, true);
    };
  }, []);
  return (
    <div ref={observeClose}>
      <button
        id="hide-welcome"
        type="button"
        onClick={() => {
          flushSync(() => {
            setVisible(false);
          });
        }}
      >
        Скрыть приветствие
      </button>
      <button
        id="show-welcome"
        type="button"
        onClick={() => {
          flushSync(() => {
            setVisible(true);
          });
        }}
      >
        Вернуть приветствие
      </button>
      <button
        id="unmount-welcome"
        type="button"
        onClick={() => {
          flushSync(() => {
            setMounted(false);
          });
        }}
      >
        Удалить приветствие
      </button>
      <button
        id="blink-welcome"
        type="button"
        onClick={() => {
          flushSync(() => {
            setVisible(false);
          });
          flushSync(() => {
            setVisible(true);
          });
        }}
      >
        Скрыть и сразу вернуть приветствие
      </button>
      <output aria-label="Native close events">{closeEvents}</output>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <WelcomeView
            privacyHref={legalDocumentPath("privacy")}
            returning={false}
            termsHref={legalEditionPath("terms", terms.version)}
          />
        ) : null}
      </Activity>
    </div>
  );
}

const meta = {
  ...environment,
  title: "Patterns/Welcome dialog lifetime",
  component: RetainedWelcome,
} satisfies Meta<typeof RetainedWelcome>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReleasesHiddenModal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole<HTMLDialogElement>("dialog", {
      name: "Добро пожаловать",
    });
    const closes = canvas.getByLabelText("Native close events");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await waitFor(() => expect(closes).toHaveTextContent("1"));
    const hide =
      canvasElement.querySelector<HTMLButtonElement>("#hide-welcome");
    const show =
      canvasElement.querySelector<HTMLButtonElement>("#show-welcome");
    const unmount =
      canvasElement.querySelector<HTMLButtonElement>("#unmount-welcome");
    if (hide === null || show === null || unmount === null)
      throw new Error("Missing fixture lifetime controls");
    hide.click();
    await expect(dialog).not.toBeVisible();
    await expect(dialog.isConnected).toBe(true);
    await expect({
      phase: "hidden before native close acknowledgement",
      modal: dialog.matches(":modal"),
      open: dialog.open,
    }).toEqual({
      phase: "hidden before native close acknowledgement",
      modal: false,
      open: false,
    });
    await waitFor(() => expect(closes).toHaveTextContent("2"));
    await expect({
      phase: "hidden after native close acknowledgement",
      modal: dialog.matches(":modal"),
      open: dialog.open,
    }).toEqual({
      phase: "hidden after native close acknowledgement",
      modal: false,
      open: false,
    });
    show.click();
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await expect(canvas.getByRole("dialog", { name: "Добро пожаловать" })).toBe(
      dialog,
    );
    await expect(
      within(dialog).getByRole("button", {
        name: "Принять условия и продолжить",
      }),
    ).toHaveFocus();
    unmount.click();
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await expect(dialog.matches(":modal")).toBe(false);
  },
};

export const LateCloseAfterReturn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole<HTMLDialogElement>("dialog", {
      name: "Добро пожаловать",
    });
    const closes = canvas.getByLabelText("Native close events");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await waitFor(() => expect(closes).toHaveTextContent("1"));
    const blink =
      canvasElement.querySelector<HTMLButtonElement>("#blink-welcome");
    if (blink === null)
      throw new Error("Missing immediate return fixture control");
    blink.click();
    await expect(closes).toHaveTextContent("1");
    await expect(dialog.matches(":modal")).toBe(true);
    await waitFor(() => expect(closes).toHaveTextContent("2"));
    await expect(dialog.matches(":modal")).toBe(true);
    dialog.close();
    await waitFor(() => expect(closes).toHaveTextContent("3"));
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    await expect(cancel.defaultPrevented).toBe(true);
    await expect(dialog.matches(":modal")).toBe(true);
  },
};

function focusExisting(element: HTMLButtonElement | null) {
  element?.focus();
}

export const KeepsExistingFocus: Story = {
  render: () => (
    <WelcomeDialog labelledBy="welcome-focus-title">
      <div className="p-6">
        <h1 id="welcome-focus-title">Проверка сохранения фокуса</h1>
        <Button type="button" data-dialog-initial-focus>
          Начальное действие
        </Button>
        <Button type="button" ref={focusExisting}>
          Уже выбранное действие
        </Button>
      </div>
    </WelcomeDialog>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole<HTMLDialogElement>("dialog", {
      name: "Проверка сохранения фокуса",
    });
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await expect(
      within(dialog).getByRole("button", { name: "Уже выбранное действие" }),
    ).toHaveFocus();
  },
};
